-- Speak2Split core schema (SQL mirror of prisma/schema.prisma)
-- Used in environments where the Prisma engine binary cannot be fetched.
-- This is the SAME data model as prisma/schema.prisma; prisma/schema.prisma
-- remains the source of truth for a normal (non-sandboxed) environment —
-- run `npx prisma migrate dev` there instead of this file.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  display_name    TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  phone           TEXT,
  normalized_phone TEXT,
  default_currency TEXT NOT NULL DEFAULT 'INR',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  display_name      TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  phone             TEXT,
  email             TEXT,
  normalized_phone  TEXT,
  normalized_email  TEXT,
  source            TEXT NOT NULL DEFAULT 'MANUAL',
  frequency_score   INTEGER NOT NULL DEFAULT 0,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, normalized_phone),
  UNIQUE(owner_user_id, normalized_email)
);
CREATE INDEX idx_contacts_owner_first ON contacts(owner_user_id, first_name);
ALTER TABLE users ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

CREATE TABLE name_aliases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  alias         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, alias, contact_id)
);
CREATE INDEX idx_alias_owner_alias ON name_aliases(owner_user_id, alias);

CREATE TYPE group_type AS ENUM ('FLAT','TRIP','FAMILY','FRIENDS','COUPLE','EVENT','CUSTOM');

CREATE TABLE groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  type          group_type NOT NULL DEFAULT 'CUSTOM',
  currency      TEXT NOT NULL DEFAULT 'INR',
  created_by_id UUID NOT NULL REFERENCES users(id),
  invite_code   TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE group_role AS ENUM ('OWNER','ADMIN','MEMBER');
CREATE TYPE group_member_status AS ENUM ('INVITED','ACTIVE','LEFT','REMOVED');

CREATE TABLE group_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      group_role NOT NULL DEFAULT 'MEMBER',
  status    group_member_status NOT NULL DEFAULT 'ACTIVE',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  UNIQUE(group_id, user_id)
);
CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TYPE split_method AS ENUM ('EQUAL','EXACT','PERCENTAGE','SHARES');
CREATE TYPE expense_source AS ENUM ('MANUAL','VOICE','RECEIPT_OCR','RECURRING','TEMPLATE');
CREATE TYPE expense_status AS ENUM ('ACTIVE','DELETED');

CREATE TABLE expenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  category       TEXT NOT NULL DEFAULT 'general',
  split_method   split_method NOT NULL DEFAULT 'EQUAL',
  source         expense_source NOT NULL DEFAULT 'MANUAL',
  status         expense_status NOT NULL DEFAULT 'ACTIVE',
  expense_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes          TEXT,
  created_by_id  UUID NOT NULL REFERENCES users(id),
  ai_raw_input   TEXT,
  ai_confidence  REAL,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date);

CREATE TABLE expense_payers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  amount_paid NUMERIC(14,2) NOT NULL,
  UNIQUE(expense_id, user_id)
);

CREATE TABLE expense_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  share_amount  NUMERIC(14,2) NOT NULL,
  share_percent NUMERIC(6,3),
  share_units   INTEGER,
  UNIQUE(expense_id, user_id)
);

CREATE TYPE settlement_method AS ENUM ('CASH','UPI','BANK_TRANSFER','OTHER');
CREATE TYPE settlement_status AS ENUM ('PENDING','COMPLETED','CANCELLED');

CREATE TABLE settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id   UUID NOT NULL REFERENCES users(id),
  amount       NUMERIC(14,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'INR',
  method       settlement_method NOT NULL DEFAULT 'CASH',
  status       settlement_status NOT NULL DEFAULT 'PENDING',
  note         TEXT,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_settlements_group_status ON settlements(group_id, status);

CREATE TABLE activity_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id   UUID NOT NULL REFERENCES users(id),
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_group_created ON activity_events(group_id, created_at);
