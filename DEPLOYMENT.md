# Deployment

This describes what actually needs to change to take this from "runs on my
machine" to a deployed product. It assumes you've read README.md's honest
status section first.

## 1. Database

Use a real MongoDB instance — MongoDB Atlas (managed, replica-set-enabled
by default) is the easiest path; self-hosted `mongod` works too but needs
a one-time `rs.initiate()` if you want the group-creation transaction to
work (see ARCHITECTURE.md).

```bash
# Atlas: create a free-tier cluster, get the connection string, set MONGODB_URI.
# Self-hosted:
mongod --replSet rs0 --dbpath /path/to/data
mongosh --eval "rs.initiate()"   # one-time
```

`apps/api/src/db/models/*.ts` is the single source of truth for the data
model — there's no separate migration step the way Prisma required;
Mongoose creates collections and indexes automatically on first use. The
`legacy-postgres-schema/` directory is archived reference material from
before the MongoDB migration and isn't used by any running code.

## 2. API server

- Set every variable in .env.example that applies to features you're
  enabling. At minimum: MONGODB_URI, JWT_ACCESS_SECRET (the server
  refuses to boot in production without a real one — see SECURITY.md).
- Set NODE_ENV=production.
- Set CORS_ALLOWED_ORIGINS to your actual mobile app's origin(s) — do not
  leave it defaulting to * in production.
- Deploy target: any Node 20+ host (Render, Railway, Fly.io, a container
  on ECS/Cloud Run, or a plain VM). Build with `npm run build` in
  apps/api, run with `npm start`.
- The Socket.IO server and the REST API currently share one HTTP server
  (apps/api/src/main.ts) — if you horizontally scale to multiple API
  instances, you need a Socket.IO adapter backed by Redis (the REDIS_URL
  variable is already documented in .env.example for this) so broadcasts
  reach clients connected to a different instance.
- The recurring-expense scheduler (node-cron, hourly) runs inside the
  same process. If you run multiple API instances, either run the
  scheduler in exactly one designated instance, or move it to a separate
  worker process — running it in every instance would generate duplicate
  expenses (the DB unique constraint would catch and reject the
  duplicates, but you'd rather not rely on that as your only defense at scale).

## 3. File storage

apps/api/src/documents/storage.ts currently writes to local disk. This is
fine for a single-instance deployment but won't survive a redeploy or work
across multiple instances. Swap the implementation for S3 (or GCS/Supabase
Storage) — the interface (saveFile/readFile/deleteFile) is already small
enough that no calling code needs to change.

## 4. External providers — what's required for which feature

| Feature | Required env vars | Notes |
|---|---|---|
| Google Sign-In | GOOGLE_OAUTH_CLIENT_ID (backend), EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (+ iOS/Android, mobile) | Same Web client ID on both sides |
| Apple Sign-In | APPLE_SIGN_IN_CLIENT_ID (backend, = bundle ID) | Requires Apple Developer Program + "Sign In with Apple" capability |
| Voice transcription | OPENAI_API_KEY (Whisper) or GOOGLE_SPEECH_API_KEY | Set STT_PROVIDER accordingly |
| Receipt OCR | GOOGLE_VISION_API_KEY | OCR_PROVIDER=google_vision |
| Email notifications | RESEND_API_KEY, EMAIL_FROM_ADDRESS | Verify your sending domain in Resend first |
| WhatsApp notifications | WHATSAPP_BUSINESS_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCESS_TOKEN | Requires a Meta Business account, approved message templates, and user opt-in per WhatsApp's policy |
| Push notifications | none extra — Expo's push service needs only a valid device token, registered via POST /notifications/devices | |
| PDF export | none | Fully self-contained (pdfkit) |

Every one of these fails with a clear, specific error (usually HTTP 503)
rather than faking success when its credential is missing — you'll know
immediately if something isn't configured, both from server logs and from
the API response itself.

## 5. Mobile app

- Standalone builds need `eas build` (EAS — Expo Application Services),
  not `expo start`. Configure eas.json with your Apple/Google signing
  credentials.
- For Google Sign-In in a standalone build, switch from the Expo Go proxy
  redirect to the app's own scheme (already set in app.json) — see the
  comments in apps/mobile/lib/googleAuth.ts.
- Apple Sign-In requires the usesAppleSignIn entitlement (already set in
  app.json) and only works on iOS.
- Set every EXPO_PUBLIC_* variable for your production API URL before
  building — these are baked into the JS bundle at build time, not read
  from a runtime .env.

## 6. Observability

PostHog and Sentry are documented in .env.example but not yet wired into
either the API or the mobile app in this codebase — that's genuinely not
done, not just unconfigured. Wiring them is a reasonably small addition
(Sentry: initialize the SDK in main.ts and the mobile _layout.tsx; PostHog:
a thin event-tracking wrapper called at the points listed in the original
product brief) but hasn't been built yet.

## 7. Before you flip this on for real users

- Add rate limiting (see SECURITY.md's honest gaps list) — /auth/login and
  /auth/register in particular.
- Restrict CORS_ALLOWED_ORIGINS.
- Mongoose creates indexes automatically, but for a large existing
  collection, build them in the background (`background: true` was the
  old option; modern MongoDB builds indexes online by default) to avoid
  locking writes during deploy.
- Decide on a backup strategy for MongoDB (Atlas has automated backups
  built in) and for uploaded documents before real users start uploading
  real bills and receipts.
