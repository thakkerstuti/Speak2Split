-- Shopping lists, expense templates, and shared documents.

CREATE TABLE shopping_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Shopping List',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX idx_shopping_lists_group ON shopping_lists(group_id);

CREATE TABLE shopping_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  quantity        TEXT,
  estimated_price NUMERIC(14,2),
  assigned_to_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  added_by_id     UUID NOT NULL REFERENCES users(id),
  is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shopping_items_list ON shopping_items(list_id);

CREATE TABLE expense_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID REFERENCES groups(id) ON DELETE CASCADE,
  owner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  title               TEXT NOT NULL,
  default_amount      NUMERIC(14,2),
  category            TEXT NOT NULL DEFAULT 'general',
  split_method        split_method NOT NULL DEFAULT 'EQUAL',
  participant_config  JSONB, -- optional saved participant shape; group members re-resolved fresh at use-time
  icon                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_templates_owner ON expense_templates(owner_id);
CREATE INDEX idx_templates_group ON expense_templates(group_id);

CREATE TABLE documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  uploaded_by_id UUID NOT NULL REFERENCES users(id),
  file_name      TEXT NOT NULL,
  file_path      TEXT NOT NULL, -- storage key/path; see storage.ts for local-disk-vs-S3 abstraction
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  category       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_documents_group ON documents(group_id);
