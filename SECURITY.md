# Security

This document describes what's actually implemented and verified in this
repository, not an aspirational checklist.

## Authentication

- Passwords hashed with bcrypt (cost factor 12), never stored or logged in
  plaintext. Verified live: registration rejects duplicate emails (409),
  login rejects wrong passwords without revealing whether the email exists.
- JWT sessions, 30-day expiry. JWT_ACCESS_SECRET must be a real value
  (>=16 chars) — see apps/api/src/config.ts. In production
  (NODE_ENV=production), the process refuses to start without it rather
  than silently falling back to an insecure default. This was a real gap
  found and fixed during development (see CHANGELOG.md).
- Google/Apple sign-in verify the provider's token server-side
  (google-auth-library for Google; native Node crypto JWK verification
  against Apple's published keys for Apple) before ever creating or
  linking an account. Verified live: a garbage token with a valid client
  ID configured returns 401, not a fake session; missing configuration
  returns 503, not a fake success.
- Account linking never creates duplicates: linking is keyed on the
  provider's stable sub claim or a verified email match against an
  existing account — never a display name.

## Authorization

Every group-scoped REST route calls assertMembership(groupId, userId)
against the live group_members table before returning or mutating
anything. Verified live:
- Non-member requesting group detail -> 403.
- Non-member attempting to download another group's document -> 403.
- A client submitting a payer total that doesn't match the expense total
  -> 422, rejected by the split engine before it reaches the database.
- Document deletion is restricted to the uploader specifically, not just
  any group member.

Socket.IO room joins are membership-checked too — this was found as a gap
during this review and fixed in the same pass: join_group now queries
group_members before allowing the socket to join a group's real-time room,
instead of trusting the client-supplied group ID. Verified live with two
socket clients: a real member receives real-time events normally; an
authenticated-but-unrelated user is rejected with a join_group_error event
and never receives that group's broadcasts.

## Identity — no name-based identity

This is one of the product's own core requirements, enforced at multiple
layers, not just documented intent:
- contacts has a UNIQUE (owner_user_id, normalized_phone) and UNIQUE
  (owner_user_id, normalized_email) constraint at the database level — two
  contacts with the same phone for the same owner is a constraint
  violation, not just an application-logic convention.
- POST /contacts schema-validates that at least one of phone/email is
  present; a bare display name is rejected with 400 before it reaches
  matching logic. Verified live.
- The name resolver never auto-resolves a genuinely ambiguous name — it
  returns AMBIGUOUS with real candidates. Covered by dedicated tests,
  including the exact "two Vanshikas in one group" scenario.

## Input validation

Every mutating route validates its body with Zod schemas before touching
the database — this matters more than usual for MongoDB specifically,
since NoSQL injection (a client passing `{ "$gt": "" }` instead of a
string, which MongoDB would otherwise happily interpret as a query
operator) is a real, distinct attack class from SQL injection. Zod's
`z.string()` etc. rejects non-string types at the schema boundary before
a value ever reaches a Mongoose query, which closes this off. Route
parameters used as MongoDB ObjectIds are validated with the shared
`objectId` Zod refinement (`apps/api/src/validation.ts`) rather than
passed to `findById` unchecked.

## File uploads

- Multer with memoryStorage() and explicit size limits (20MB documents,
  10MB receipt images, 25MB audio).
- Document download re-verifies group membership on every request.
- Local disk storage writes files under a UUID-derived filename, never the
  user-supplied original filename, preventing path traversal via a
  crafted filename.

## Secrets

- .env.example documents every variable; no real secret is committed
  anywhere (the sandbox .env used during development was deliberately
  excluded from every packaged export of this repository).
- External provider calls (Resend, WhatsApp Cloud API, Google Vision,
  OpenAI Whisper, Google/Apple auth) read credentials from process.env at
  call time. Provider error messages are surfaced to the caller, but raw
  API-key values are never included in any error string or log line.

## What's NOT yet implemented (be honest about this)

- Rate limiting is not implemented on any endpoint — a real gap for a
  production deployment, particularly on /auth/login and /auth/register.
- CORS defaults to * if CORS_ALLOWED_ORIGINS is unset — fine for local
  development, must be restricted before production.
- No CSRF protection (not required for a pure Bearer-token API consumed by
  a mobile app, but relevant if a web client is ever added).
- No dedicated security audit log beyond what activity_events captures for
  expense/group actions specifically — login failures and permission
  denials are not currently logged anywhere separate from stdout.
- Webhook signature verification isn't applicable yet since no inbound
  webhooks (e.g. WhatsApp delivery status callbacks) are implemented.

## Sandbox-specific note

This repository was developed and tested in a sandboxed environment whose
outbound network policy blocks some external hosts (e.g.
www.googleapis.com, binaries.prisma.sh). Where that affected what could be
proven live rather than reflecting a real code limitation, it's called out
explicitly in README.md and ARCHITECTURE.md.
