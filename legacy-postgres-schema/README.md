# Legacy: PostgreSQL/Prisma schema (superseded)

This directory is kept for historical reference only. Speak2Split's
database was fully migrated from PostgreSQL/Prisma to MongoDB/Mongoose —
see CHANGELOG.md for when and why, and ARCHITECTURE.md for the current
data model.

The current, live source of truth for the data model is
`apps/api/src/db/models/*.ts` (Mongoose schemas).

Nothing in this directory is imported or used by any running code.
