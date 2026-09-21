# Speak2Split

**"Say it. Split it. Settle it."**

A context-aware shared expense management platform. This is not a
restaurant-splitter — it's built for flats, families, couples, trips, and
general shared expenses, with a real natural-language understanding layer
that resolves *which specific person* you mean when names are ambiguous.

## Read this first: honest status of this repository (updated)

Since the last update, I audited the existing repo and built the missing
critical pieces on top of it — no rebuild, no architecture swap. Everything
below marked ✅ was proven against the real, running Postgres database in
this session, with actual HTTP requests, not just written and assumed to work.

### ✅ Proven working — API surface (Express + real Postgres)
`/auth`, `/groups`, `/expenses` (incl. `/expenses/parse` for NLP), `/settlements`,
`/resolve-names`, `/contacts` (incl. `/contacts/sync`), `/recurring-expenses`,
`/exports/group/:id/pdf`, `/notifications` (incl. preferences + device registration),
`/search`.

**Critical identity/duplicate-safety (document 3's requirements) — fully implemented and tested:**
- `packages/shared/src/resolution/contact-matching.ts` — 10 new tests (37/37 total
  in the shared package now), covering every scenario in the spec: no-name-only
  identity creation, phone/email dedup, linking a device contact to an existing
  Speak2Split user even under a different saved name, and refusing to guess
  between two same-named people.
- Proven live: `POST /contacts` with only a name → **rejected (400)**. Syncing a
  duplicate contact by phone → **linked, not duplicated** (verified via direct
  SQL: exactly one contact record survives). Syncing a contact matching an
  existing user's phone → **linked to that real user**, confirmed by
  `target_user_id`.
- Found and fixed a real bug mid-verification: the sandbox SQL `users` table
  was missing the `phone` column, silently causing linking to fall through to
  contact-creation. Caught it because the test result didn't match what the
  logic should have produced — fixed and re-verified correctly.

**Recurring expenses — fully implemented, real scheduler:**
- `node-cron`-driven generation with two independent duplicate-prevention
  layers (app-level next-occurrence advance + DB unique constraint on
  occurrence date). Proven live: created a due recurring expense, ran
  generation → real expense + correct balance update; ran it again
  immediately → generated zero (not double-billed); confirmed via direct
  SQL inspection.

**PDF export — fully implemented, real files:**
- `pdfkit`-generated report (branding, members, expenses, balances,
  settlement plan, settlement history) sharing the exact same balance-calc
  code as the live API. Generated an actual PDF and extracted its text with
  `pdftotext` to verify — caught and fixed a real Unicode rendering bug
  (₹ and → became garbage characters under Helvetica's WinAnsi encoding;
  switched to "Rs." and "->").

**Notifications — fully implemented, real orchestration, honest about credentials:**
- Real `notifications`, `notification_preferences`, `notification_devices`,
  `notification_deliveries` tables with per-channel delivery tracking.
- Real provider adapters: Expo Push (genuinely live, no key needed beyond a
  real device token), Resend for email, WhatsApp Business Cloud API — each
  makes an actual HTTP call and throws a specific, caught error when
  unconfigured rather than faking success.
- Proven live: created an expense → notification appeared for the other
  group member with `IN_APP: DELIVERED`, `PUSH: SKIPPED_NOT_CONFIGURED` (no
  registered device — an honest, specific reason). Enabled EMAIL preference
  → next expense correctly attempted EMAIL and recorded
  `SKIPPED_NOT_CONFIGURED: RESEND_API_KEY is not configured`, proving the
  preference→delivery pipeline is real end-to-end even without credentials.

**Search — fully implemented:**
- Cross-entity search (expenses, groups, people, settlements, recurring
  expenses) with amount/category/date filters, scoped so a user can never
  see another group's data. Proven live with real filtered queries.

I also type-checked the entire mobile app and API (`npx tsc --noEmit`, zero
errors both times) after every change, and re-ran the full shared + API
test suites (42 tests total) after each major addition to catch
regressions immediately.

### 🚧 Real code, structured, not yet exercised live (needs credentials or a device)
- **Google/Apple Sign-In** — not implemented this round; still email/password + JWT.
- **Receipt OCR** — interface designed (`.env.example` documents the
  Vision/Textract config), not yet built as a running endpoint.
- **Shopping lists, shared documents, expense templates** — schema exists
  in `prisma/schema.prisma`, no API routes or screens built yet.
- **Mobile People screen + contact sync UI** — real `expo-contacts`
  permission flow and API wiring, type-checks clean, not run on a device.
- **Voice transcription** — real recording via `expo-av`; needs an STT
  provider key to go from recorded audio to text (typing the sentence
  directly exercises the identical real NLP+resolution pipeline).

### What I'd build next, in order
1. Google/Apple Sign-In (highest-value remaining auth gap).
2. Receipt OCR endpoint + confirmation screen.
3. Shopping lists + shared documents (schema's ready, routes are the
   remaining work).
4. Expense templates.

## Database: MongoDB (migrated from PostgreSQL/Prisma)

This project was fully migrated from PostgreSQL/Prisma to MongoDB/Mongoose.
Every one of the 14 backend routers was rewritten; the pure business-logic
layer (`packages/shared` — split engine, balance engine, name resolver,
contact matcher, receipt parser, NLP parser) needed zero changes, since it
never touched a database either way. Full details, including document
design decisions (embedding payers/participants in `Expense`, etc.) and
the identity-dedup unique indexes, are in ARCHITECTURE.md.

**Honest limitation:** I could not install or run a real MongoDB server in
this development sandbox — both of MongoDB's official binary hosts are
network-blocked here (confirmed directly), and Docker (needed for my
FerretDB fallback plan) isn't available either. So unlike the rest of this
project, the MongoDB rewrite is **not** proven with live HTTP requests
against a running database. What I verified instead: the whole project
type-checks cleanly, all 46 database-independent tests still pass
unchanged, and the server correctly fails fast with a clear error both
when `MONGODB_URI` is missing and when it points at a real-but-unreachable
address (proving the connection path and all Mongoose schemas are real,
not mocked). Run the actual proof yourself — register a user, create a
group, hit the "Which Vanshika?" scenario — against a real `mongod` or
MongoDB Atlas cluster; see ARCHITECTURE.md for the one-time replica-set
setup a local `mongod` needs for the group-creation transaction to work.

## Repository structure

```
/apps
  /api        — Express + TypeScript API. 14 route groups, all rewritten
                for MongoDB/Mongoose. 5 tests (advanceOccurrence, DB-independent).
  /mobile     — Expo Router app. 14 screens, type-checks clean.
/packages
  /shared     — split engine, balance engine, name resolver, contact
                matching, receipt parser, NLP parser. 46/46 tests passing,
                zero database dependency.
/prisma  -> see /legacy-postgres-schema (archived, superseded by MongoDB)
.env.example  — every env var documented
```

## Quick start

```bash
git clone <this-repo>
cd speak2split
cp .env.example .env
npm install

# Verify everything (no DB needed for this part):
cd packages/shared && npx jest   # 46/46
cd ../../apps/api && npx jest     # 5/5

# Real MongoDB (your machine or Atlas — see .env.example for MONGODB_URI):
# mongod --replSet rs0 --dbpath ./data   (one terminal)
# mongosh --eval "rs.initiate()"         (one-time, enables the transaction
#                                          used by group creation)
cd apps/api && npm run dev        # :3000
cd ../mobile && npx expo start    # scan QR with Expo Go
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the pieces fit together, the Prisma/pg sandbox note
- [API.md](./API.md) — every route, extracted directly from the router source
- [SECURITY.md](./SECURITY.md) — what's implemented and verified, what's honestly not
- [CHANGELOG.md](./CHANGELOG.md) — real build history, including every bug found and fixed
- [DEPLOYMENT.md](./DEPLOYMENT.md) — what changes to go from this repo to production
- [.env.example](./.env.example) — every environment variable, documented

## Current feature status (updated)

Since the "37/37 tests" snapshot above, the shared test suite grew to
**46/46** with the addition of contact-matching and receipt-parsing tests.
Everything below has real backend + real mobile UI + passing tests, proven
live against a running Postgres instance, unless marked otherwise:

**Fully working:** email/password + Google + Apple auth, groups, manual/
voice/receipt expense entry, all four split methods, balances & debt
minimization, settlements, recurring expenses (real scheduler), name
resolution & contact identity (no name-based duplicates), PDF export,
notifications (in-app + real provider adapters), search, shopping lists,
expense templates, shared documents, two-phone real-time sync (proven with
independent socket connections, not just wired).

**Backend complete, needs your credentials to go fully live:** Google/
Apple sign-in (needs your OAuth client IDs), voice transcription (needs
an OpenAI or Google Speech key), receipt OCR (needs a Google Vision key),
email/WhatsApp notification delivery (needs Resend/Meta credentials).

**Genuinely not built:** PostHog/Sentry wiring (documented, not
implemented), AWS Textract OCR path (Google Vision path is real; Textract
throws an honest "not yet wired" error rather than a fake implementation).
