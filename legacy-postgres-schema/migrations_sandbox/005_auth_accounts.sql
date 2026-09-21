-- OAuth provider account linking (Google, Apple), mirrors prisma AuthAccount.

CREATE TYPE auth_provider AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

CREATE TABLE auth_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         auth_provider NOT NULL,
  provider_user_id TEXT NOT NULL, -- Google `sub` / Apple `sub`
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX idx_auth_accounts_user ON auth_accounts(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL; -- already nullable, no-op safety
