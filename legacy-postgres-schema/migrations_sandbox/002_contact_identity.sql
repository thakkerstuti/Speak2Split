-- Incremental migration: contact identity (phone/email dedup) support.
-- Mirrors the updated prisma/schema.prisma Contact model.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_phone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_owner_user_id_normalized_phone_key'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_owner_user_id_normalized_phone_key UNIQUE (owner_user_id, normalized_phone);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_owner_user_id_normalized_email_key'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_owner_user_id_normalized_email_key UNIQUE (owner_user_id, normalized_email);
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS normalized_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
