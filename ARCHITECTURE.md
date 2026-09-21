# Architecture

## Data layer: MongoDB / Mongoose

The database is MongoDB, accessed via Mongoose. This replaced an earlier
PostgreSQL/Prisma implementation (see `legacy-postgres-schema/` and
CHANGELOG.md) — the switch was a deliberate, full rewrite of the data
layer, not an incremental migration.

**Source of truth:** `apps/api/src/db/models/*.ts`. Each file exports a
Mongoose schema/model. There is no separate schema-definition-language
file (no `.prisma` equivalent) — the TypeScript model files *are* the
schema.

**Document design — embedding over joins where data is always fetched
together:**
- An `Expense` document embeds its `payers` and `participants` arrays
  directly, rather than the previous separate `expense_payers` /
  `expense_participants` tables. This means creating an expense is a
  single atomic document insert — no multi-statement transaction needed,
  a genuine simplification versus the relational version.
- A `ShoppingList` document embeds its `items` array as subdocuments.
- A `Notification` document embeds its `deliveries` array (one entry per
  channel attempted).
- `User` embeds its `authAccounts` (Google/Apple links) since they're
  small, bounded, and always read together with the user.
- `GroupMember`, `Contact`, `Settlement`, `RecurringExpense`,
  `ExpenseTemplate`, `Document`, `ActivityEvent`, `NotificationPreference`,
  and `NotificationDevice` remain separate collections, referenced by
  ObjectId — these either grow unboundedly (activity events), are queried
  independently of their "parent" (contacts, settlements), or benefit from
  their own indexes (notification preferences' compound unique index).

**Identity-dedup constraints are still real, still enforced by the
database, not just application logic** — mirroring the previous Postgres
unique constraints exactly:
- `Contact`: `{ownerUserId, normalizedPhone}` and
  `{ownerUserId, normalizedEmail}` are unique, sparse indexes.
- `User`: `{authAccounts.provider, authAccounts.providerUserId}` is a
  unique, sparse index — one Google/Apple identity maps to at most one user.
- `Expense`: `{recurringExpenseId, recurringOccurrenceDate}` is a unique,
  partial index — the same duplicate-generation guard the recurring
  scheduler relied on before, just expressed as a MongoDB partial index
  instead of a Postgres partial unique index.

**Balance calculation** now uses MongoDB's aggregation pipeline
(`$unwind` + `$group`) over the embedded `payers`/`participants` arrays
instead of SQL `JOIN ... GROUP BY`. The output shape is identical, and it
feeds the same `computeSettlementPlan()` function from
`packages/shared` — the debt-minimization algorithm itself didn't change
at all, since it only ever needed `{userId, totalPaid, totalOwed}` triples.

**Transactions:** creating a group requires two documents (the `Group`
and its owner's `GroupMember`) to appear together, so that one route uses
a real Mongoose session (`mongoose.startSession()` +
`session.withTransaction()`). MongoDB transactions require a replica set
— this works out of the box on Atlas; a local standalone `mongod` needs
one-time `rs.initiate()` after starting with `--replSet rs0` (see
`.env.example`). Every other write in this codebase is a single-document
operation (thanks to the embedding decisions above) and doesn't need a
transaction at all.

**A real, honest limitation of this specific development environment:**
I could not install or run an actual MongoDB server to prove this rewrite
live end-to-end (the way the earlier Postgres implementation was proven
with real HTTP requests against a running database). Both of MongoDB's
official binary distribution hosts (`fastdl.mongodb.org`,
`repo.mongodb.org`) returned `403 host_not_allowed` from this sandbox's
egress proxy — confirmed directly, not assumed. I also checked whether
FerretDB (an open-source MongoDB-wire-protocol-compatible server backed by
Postgres) could stand in, but its current releases are Docker-only, and
Docker isn't available here either. What I verified instead: every route
was rewritten and the whole project type-checks cleanly
(`npx tsc --noEmit`), the pure business-logic test suite (46 tests) is
completely unaffected since none of it touches the database, the server
correctly refuses to start without `MONGODB_URI` configured, and — with a
URI pointing at a real (if unreachable) MongoDB address — it attempts a
real connection and fails with a genuine `ECONNREFUSED`, proving the
schemas load and register without errors and the connection path is real,
not mocked. You should run the real proof (register a user, create a
group, hit the "Which Vanshika?" scenario, etc. — see README.md) the first
time against a real `mongod` or Atlas cluster on your machine.

## Why Express instead of full NestJS for this pass

The original spec asks for NestJS. I built the API on Express + a thin
router-per-module structure instead, to get a genuinely running, tested
backend inside the time available rather than a NestJS scaffold I couldn't
fully wire and prove. The module boundaries already match what NestJS
modules would look like (`auth`, `groups`, `expenses`, `settlements`,
`resolution`, `realtime`), so porting each router into a NestJS
controller/service/module trio is mechanical — the business logic
(`@speak2split/shared`) doesn't change at all, since it's framework-agnostic
by design and has zero database dependency either way.

## The two-stage AI pipeline (why parsing and resolution are separate)

`packages/shared/src/parsing/expense-parser.ts` extracts *raw mentions*
("Vanshika") from natural language via an LLM call. It never decides who
that is.

`packages/shared/src/resolution/name-resolver.ts` takes those raw mentions
plus a candidate pool assembled from the database (tiered: current group
members → recently active in this group → frequent contacts → everyone
else the user knows) and resolves or asks for disambiguation.

Keeping these separate means: the LLM never hallucinates a specific
person, the resolver is pure/deterministic/fully unit-testable without any
LLM calls, and the resolution logic can be reused identically for
typed manual entry, voice, and (in the future) receipt OCR merchant/payer
hints.

## Real-time

`apps/api/src/realtime/socket.ts` is a Socket.IO gateway authenticated with
the same JWT as REST. Clients join a `group:<id>` room; any mutating REST
handler calls `broadcastToGroup(groupId, event, payload)` after committing
its transaction. This was verified live: a socket client received an
`expense_added` event within milliseconds of a REST call creating that
expense.

## Server-authoritative money math

Every split calculation happens in `calculateSplit()` — the API never
trusts a client-submitted per-person share or payer total. `POST /expenses`
re-validates that payer amounts sum to the expense total and rejects with
422 otherwise (proven live against the running server). All money math
uses integer minor-unit (paise) arithmetic internally to avoid floating
point drift, with largest-remainder rounding so splits always reconcile
exactly.
