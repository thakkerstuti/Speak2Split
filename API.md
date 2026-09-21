# API Reference

Base URL: `http://localhost:3000` (or `API_BASE_URL` / `EXPO_PUBLIC_API_BASE_URL`).

Every route below is extracted directly from the router source files, not
written from memory — if a route isn't listed here, it doesn't exist yet.

All routes except `/health`, `/auth/register`, `/auth/login`, `/auth/google`,
and `/auth/apple` require `Authorization: Bearer <jwt>`. Group-scoped routes
additionally verify the caller is an active member of that group server-side
(`assertMembership`) — never trust a client-supplied group ID alone.

## Health

- `GET /health` — liveness check, no auth. Returns `{ status, timestamp }`.

## Auth (`/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | none | `{ email, password, displayName, phone? }` → `{ token, user }` |
| POST | `/auth/login` | none | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | JWT | Full profile incl. `avatarUrl`, `authProviders[]` |
| POST | `/auth/google` | none | `{ idToken }` — server-verifies against Google's public keys |
| POST | `/auth/apple` | none | `{ identityToken, fullName? }` — server-verifies against Apple's public keys |

Google/Apple both return `503` if the corresponding `*_CLIENT_ID` env var
isn't configured, and `401` if the token fails verification — never a fake
success.

## Groups (`/groups`)

| Method | Path | Notes |
|---|---|---|
| POST | `/groups` | `{ name, type?, currency? }` — creator becomes OWNER |
| GET | `/groups` | Groups the caller is an active member of |
| GET | `/groups/:groupId` | Detail + member list |
| POST | `/groups/:groupId/members` | `{ email }` — must already have a Speak2Split account |

## Expenses (`/expenses`)

| Method | Path | Notes |
|---|---|---|
| POST | `/expenses` | Server computes the split via `calculateSplit()` — client totals are re-validated, never trusted |
| POST | `/expenses/parse` | `{ groupId, utterance }` — NLP extraction + name resolution; returns a draft only, never creates an expense |
| GET | `/expenses/group/:groupId` | Expense list with payers/participants |

## Name resolution (`/resolve-names`)

- `POST /resolve-names` — `{ groupId, mentions: string[] }` → per-mention `RESOLVED` / `AMBIGUOUS` (with candidates) / `NOT_FOUND`.

## Contacts (`/contacts`)

| Method | Path | Notes |
|---|---|---|
| GET | `/contacts` | Caller's known people, most-used first |
| POST | `/contacts` | `{ displayName, phone?, email? }` — rejects if neither phone nor email given |
| POST | `/contacts/sync` | `{ contacts: [{ displayName, phones[], emails[] }] }` — bulk device-contact sync; links to existing users/contacts by phone/email, never duplicates |

## Settlements & balances (`/settlements`)

| Method | Path | Notes |
|---|---|---|
| GET | `/settlements/group/:groupId/balances` | Live net balances + debt-minimized settlement plan |
| POST | `/settlements` | `{ groupId, toUserId, amount, method?, note? }` |
| POST | `/settlements/:settlementId/complete` | Marks complete, updates ledger, fires notification + real-time event |

## Recurring expenses (`/recurring-expenses`)

| Method | Path | Notes |
|---|---|---|
| POST | `/recurring-expenses` | Validates the split config immediately using the same engine the scheduler uses |
| GET | `/recurring-expenses/group/:groupId` | List, ordered by next occurrence |
| POST | `/recurring-expenses/:id/pause` | Sets isActive = false |

Generation runs hourly via node-cron (startRecurringScheduler in main.ts),
with a DB-level unique constraint on (recurring_expense_id, occurrence_date)
as a second, independent duplicate-prevention layer.

## Templates (`/templates`)

| Method | Path | Notes |
|---|---|---|
| POST | `/templates` | `{ groupId?, name, title, defaultAmount?, category?, splitMethod? }` |
| GET | `/templates?groupId=` | Personal templates + this group's shared templates |
| PATCH | `/templates/:id` | Owner-only |
| DELETE | `/templates/:id` | Owner-only |
| GET | `/templates/:id/resolve?groupId=` | Returns fields plus the group's CURRENT live membership, never stale IDs from creation time |

## Shopping lists (`/shopping`)

| Method | Path | Notes |
|---|---|---|
| GET | `/shopping/group/:groupId` | Auto-creates the group's default list on first access |
| POST | `/shopping/items` | `{ listId, name, quantity?, estimatedPrice?, assignedToId? }` |
| PATCH | `/shopping/items/:id` | Partial update, incl. isCompleted |
| DELETE | `/shopping/items/:id` | — |

All mutations broadcast shopping_item_updated over Socket.IO to the group room.

## Documents (`/documents`)

| Method | Path | Notes |
|---|---|---|
| POST | `/documents/group/:groupId` | multipart file field; stored via the storage abstraction (local disk in dev, swap for S3 in prod) |
| GET | `/documents/group/:groupId` | List, newest first |
| GET | `/documents/:id/download` | Streams the file; verifies group membership before returning bytes |
| DELETE | `/documents/:id` | Uploader only — being a group member isn't sufficient to delete someone else's upload |

## Voice (`/voice`)

- `POST /voice/transcribe` — multipart audio field. Real STT call (OpenAI
  Whisper or Google Speech-to-Text, per STT_PROVIDER). Returns
  `{ transcript, languageDetected? }` only — never runs NLP/resolution
  itself. Feed the transcript into POST /expenses/parse next, the same path
  typed text uses. Returns 503 if the configured provider's API key is missing.

## Receipts (`/receipts`)

- `POST /receipts/scan` — multipart image field + groupId. Real OCR call
  (Google Vision, per OCR_PROVIDER), then the tested extractReceiptFields
  heuristic. Returns a draft with confidence, amountSource, and
  needsReview/reviewMessage when confidence is low. Never creates an
  expense — the client must POST to /expenses after the user confirms.
  Returns 503 if the OCR provider's API key is missing.

## Notifications (`/notifications`)

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | Last 100, newest first |
| POST | `/notifications/:id/read` | — |
| POST | `/notifications/read-all` | — |
| GET | `/notifications/preferences` | Only explicitly-set overrides; unset = default (IN_APP/PUSH on, EMAIL/WHATSAPP off) |
| PUT | `/notifications/preferences` | `{ type, channel, enabled }` |
| POST | `/notifications/devices` | `{ expoPushToken, platform }` — registers for push |

## Search (`/search`)

- `GET /search?q=&groupId=&minAmount=&maxAmount=&category=&dateFrom=&dateTo=`
  — cross-entity search (expenses, groups, people, settlements, recurring
  expenses), always scoped to the caller's own group memberships.

## PDF export (`/exports`)

- `GET /exports/group/:groupId/pdf` — streams a real generated PDF
  (branding, members, expenses, balances, settlement plan, settlement
  history) using pdfkit, sharing the exact balance-calculation code the
  live /settlements endpoint uses.

## Real-time (Socket.IO, not HTTP)

Connect with `{ auth: { token: <jwt> } }`. Emit join_group / leave_group
with a group ID. Server broadcasts: expense_added, expense_updated,
expense_deleted, settlement_created, settlement_completed,
recurring_expense_created, shopping_item_updated, notification_created.
See apps/mobile/lib/realtime.ts and useGroupRealtime.ts for the client
lifecycle pattern (one socket per app session, never per screen).

## Error shape

Every error response is `{ "error": "human-readable message" }`, optionally
with `details` for Zod validation failures. Status codes used consistently:
400 validation, 401 unauthenticated, 403 unauthorized (wrong group / wrong
owner), 404 not found, 422 semantically invalid (e.g. split doesn't
reconcile, OCR found no text), 503 required external provider not configured.
