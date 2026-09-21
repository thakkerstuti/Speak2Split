-- Recurring expenses: real backend-scheduled generation with duplicate prevention.

CREATE TYPE recurring_frequency AS ENUM ('DAILY','WEEKLY','BIWEEKLY','MONTHLY','YEARLY');

CREATE TABLE recurring_expenses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  category            TEXT NOT NULL DEFAULT 'general',
  split_method        split_method NOT NULL DEFAULT 'EQUAL',
  payer_config        JSONB NOT NULL, -- [{userId, amountPaid}]
  participant_config  JSONB NOT NULL, -- [{userId}] (equal split; extend for other methods)
  frequency           recurring_frequency NOT NULL DEFAULT 'MONTHLY',
  start_date          TIMESTAMPTZ NOT NULL,
  end_date            TIMESTAMPTZ,
  next_occurrence     TIMESTAMPTZ NOT NULL,
  last_generated_at   TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id       UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recurring_group_active ON recurring_expenses(group_id, is_active);
CREATE INDEX idx_recurring_next_occurrence ON recurring_expenses(next_occurrence, is_active);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurring_expense_id UUID REFERENCES recurring_expenses(id) ON DELETE SET NULL;

-- Duplicate-generation guard: a given recurring_expense can only produce ONE
-- expense per calendar occurrence date (enforced at the DB level, not just
-- app logic, so a scheduler double-run or race condition cannot double-bill).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurring_occurrence_date DATE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recurring_occurrence
  ON expenses(recurring_expense_id, recurring_occurrence_date)
  WHERE recurring_expense_id IS NOT NULL;
