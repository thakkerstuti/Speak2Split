-- Notification system: in-app records, per-user channel preferences, and
-- per-channel delivery tracking (so we always know what was actually sent
-- vs skipped vs failed, per document's requirement to never fake sending).

CREATE TYPE notification_type AS ENUM (
  'EXPENSE_ADDED','EXPENSE_EDITED','EXPENSE_DELETED','PAYMENT_REMINDER',
  'SETTLEMENT_CREATED','SETTLEMENT_COMPLETED','GROUP_INVITATION','MEMBER_JOINED',
  'RECURRING_EXPENSE_CREATED','COMMENT_ADDED','SHOPPING_ITEM_UPDATED','OTHER'
);
CREATE TYPE notification_channel AS ENUM ('IN_APP','PUSH','EMAIL','WHATSAPP');
CREATE TYPE notification_delivery_status AS ENUM ('PENDING','SENT','DELIVERED','FAILED','SKIPPED_PREFERENCE','SKIPPED_NOT_CONFIGURED');

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   UUID REFERENCES groups(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read_at);
CREATE INDEX idx_notifications_group ON notifications(group_id);

CREATE TABLE notification_preferences (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     notification_type NOT NULL,
  channel  notification_channel NOT NULL,
  enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, type, channel)
);
CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id);

CREATE TABLE notification_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT UNIQUE NOT NULL,
  platform        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_devices_user ON notification_devices(user_id);

CREATE TABLE notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         notification_channel NOT NULL,
  status          notification_delivery_status NOT NULL DEFAULT 'PENDING',
  provider_ref    TEXT,
  error           TEXT,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);
CREATE INDEX idx_notification_deliveries_notification ON notification_deliveries(notification_id);
