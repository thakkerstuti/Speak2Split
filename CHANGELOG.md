# Changelog

## Database migration: PostgreSQL/Prisma → MongoDB/Mongoose

Full replacement, not incremental: all 12 data models rewritten as
Mongoose schemas, all 14 backend routers rewritten to use them, `pg` and
Prisma dependencies removed, old schema archived to
`legacy-postgres-schema/`.

**Design decisions made during the rewrite:**
- Embedded `payers`/`participants` directly in the `Expense` document
  instead of separate join tables — this made expense creation a single
  atomic document write, eliminating the need for a transaction that the
  Postgres version required.
- Embedded `items` in `ShoppingList` and `deliveries` in `Notification`
  for the same reason: always read/written together with their parent.
- Kept `GroupMember`, `Contact`, `Settlement`, and others as separate
  collections where they're queried independently or grow unboundedly.
- Balance calculation moved from SQL `JOIN ... GROUP BY` to a MongoDB
  aggregation pipeline (`$unwind` + `$group`); the output feeds the exact
  same `computeSettlementPlan()` shared function, unchanged.
- Re-implemented every unique-constraint-based duplicate-identity guard
  (contact phone/email dedup, one-Google-account-per-user, recurring
  expense duplicate-generation prevention) as MongoDB unique/partial
  indexes — the guarantees are the same, only the mechanism changed.
- One real MongoDB transaction remains (group creation, which touches two
  documents); every other write is single-document and needs no
  transaction at all, a direct benefit of the embedding decisions above.

**What could not be proven live in this session:** unlike every other
major piece of this project, I could not run this rewrite against a real
MongoDB instance — the sandbox's network policy blocks both of MongoDB's
official binary distribution hosts (confirmed directly: both returned
`403 host_not_allowed`), and my fallback plan (FerretDB, an open-source
MongoDB-wire-protocol server) turned out to be Docker-only in its current
releases, and Docker isn't available here either. What I verified instead:
full TypeScript compilation across the rewrite, all 46 pure-logic tests
(unaffected, since they never touched a database), and that the server
fails safely and clearly both with no `MONGODB_URI` set and with one
pointing at a real-but-unreachable address (a genuine `ECONNREFUSED`,
proving the connection code and schema registration are real).

Dates approximate the working sessions, not calendar time. Every entry
below reflects something actually built and tested, and every "fixed" entry
was a real bug caught during testing, not a hypothetical.

## Core engines & foundation

- Split engine (equal/exact/percentage/shares, multi-payer), balance
  engine (debt minimization), name resolver, NLP expense parser.
- Postgres schema covering users, groups, expenses, settlements,
  recurring expenses, contacts, notifications, shopping lists, templates,
  documents.
- Express + TypeScript API, Socket.IO real-time layer.
- Expo Router mobile app: auth, dashboard, groups, add-expense (manual /
  voice / receipt modes), profile.

**Bugs found and fixed during initial testing:**
- Name resolver: an early version let "Ishika" incorrectly fuzzy-match a
  "Vanshika" query due to a too-loose Levenshtein-ratio threshold. Fixed
  by switching to absolute edit-distance thresholds for fuzzy matching.
- Name resolver: two same-tier candidates with an identical exact-name
  match could collapse into a false "resolved" result because the
  contextual-boost scoring capped before comparison, erasing the tie-break
  signal. Fixed by restructuring resolution into explicit priority tiers
  (group member > recent > frequent > other) with within-tier scoring only.

## Contact identity & duplicate-name safety

- contact-matching.ts: pure identity-resolution logic — phone/email
  dedup, never creates an identity from a name alone.
- /contacts, /contacts/sync endpoints.

**Bugs found and fixed:**
- The sandbox SQL users table was missing a phone column entirely, which
  silently caused device-contact-to-existing-user linking to fall through
  to contact-creation instead. Found because a live test's result
  (linkedToUser: 0) didn't match the expected behavior. Fixed by adding
  the column and re-verifying linkedToUser: 1.

## Recurring expenses, PDF export, notifications, search

- node-cron scheduler with two-layer duplicate-generation prevention
  (app-level next-occurrence advance + DB unique constraint).
- pdfkit-based PDF export sharing the live balance-calculation code.
- Notification orchestration (Expo Push, Resend email, WhatsApp Cloud API
  adapters) with per-channel delivery tracking.
- Cross-entity search with filters.

**Bugs found and fixed:**
- PDF export: the Rupee symbol and arrow character rendered as garbled
  characters because PDFKit's default Helvetica font uses WinAnsi
  encoding, which doesn't include those glyphs. Found by extracting the
  generated PDF's text with pdftotext and inspecting it. Fixed by
  switching to "Rs." and "->" in the PDF renderer specifically (the
  mobile app UI still uses the real symbol normally, since React Native
  handles Unicode fine).

## Auth: Google & Apple sign-in

- Backend: real server-side token verification for both providers.
- Mobile: expo-auth-session (Google) and expo-apple-authentication (Apple)
  flows, wired to the backend.

**Bugs found and fixed:**
- Initial Apple verification used the jwks-rsa package, which pulls in
  jose, an ESM-only dependency that broke the CommonJS/ts-jest test
  runner for an unrelated test file (recurring.test.ts, via a shared
  import chain through auth.router.ts). Fixed by replacing jwks-rsa with
  a dependency-free implementation using Node's native
  crypto.createPublicKey (JWK import, supported since Node 16).
- JWT_ACCESS_SECRET silently fell back to an insecure hardcoded default
  with no environment-based gating. Fixed: centralized into
  apps/api/src/config.ts, which now throws on boot in production if the
  secret is missing or too short.
- /auth/me returned snake_case fields (display_name, avatar_url) while
  /auth/login and /auth/register return camelCase — an inconsistency that
  would have broken user.displayName access on the client depending on
  which endpoint populated the session. Fixed to be consistent camelCase
  everywhere.

## Mobile: shopping lists, templates, documents, search, notifications

- Full CRUD screens for all five, wired to the pre-existing backends.
- Templates' "use" flow re-resolves current group membership live rather
  than trusting IDs saved at template-creation time.

**Dependency issues found and fixed:**
- expo-contacts was pinned to ^57.0.4 in package.json — a major version
  far ahead of the Expo SDK 51 this app targets (should be ~13.0.5). This
  wasn't just an install artifact; it was wrong in the source. Fixed at
  the source and verified with a full clean rm -rf node_modules && npm install.
- Several Expo packages (expo-file-system, expo-sharing) intermittently
  resolved to stale, wrong-major-version copies nested inside
  apps/mobile/node_modules even when the root package.json pinned the
  correct version — an npm workspace hoisting quirk in this environment.
  Resolved definitively with a full clean reinstall rather than repeated
  spot-deletion of individual stale folders.

## Real-time: mobile Socket.IO client

- Centralized single-socket lifecycle (lib/realtime.ts, useGroupRealtime
  hook) — connect on login, disconnect on logout, one connection for the
  whole app rather than per-screen.
- Proven with two independent authenticated socket clients (not just code
  review): Phone A creates an expense via REST, Phone B — a different
  logged-in user, in the same group — receives the expense_added
  broadcast automatically.

**Security gap found and fixed (same session):**
- The join_group Socket.IO handler accepted any group ID from any
  authenticated user without checking membership, meaning a
  connected-but-unrelated user could join another group's real-time room
  and receive its events (though REST access remained correctly
  restricted throughout). Fixed by adding the same assertMembership check
  used everywhere else, and verified live with two socket clients: a real
  member receives events normally, an outsider is rejected with a
  join_group_error event.

## Voice & receipt pipelines

- Real speech-to-text (OpenAI Whisper primary, Google Speech-to-Text
  alternate) and real OCR (Google Vision) provider integrations — both
  fail with a specific, honest error when their API key isn't configured,
  never a fake result.
- extractReceiptFields: label-based total extraction ("TOTAL", "GRAND
  TOTAL", "AMOUNT DUE") rather than picking the largest number on the
  receipt, with an explicit low-confidence fallback path.
- Mobile: real audio upload for voice, real camera/gallery capture for
  receipts, both feeding into an editable confirmation screen before any
  expense is created.

**Bugs found and fixed (caught by tests, not inspection):**
- The all-amounts regex used for the "no labeled total found" fallback
  path couldn't match numbers longer than 3 digits without comma
  grouping — "99999" matched as "999". Fixed the regex to allow unbounded
  leading digits.
- "Amount Due" was unintentionally captured by the highest-priority
  "Grand Total" pattern tier (both were in the same regex alternation),
  so a receipt with only "Amount Due" never hit its own dedicated,
  lower-priority pattern. Fixed by separating the tiers cleanly.
