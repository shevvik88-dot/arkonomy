CREATE TABLE IF NOT EXISTS credit_cards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  apr        NUMERIC(5,2),
  balance    NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_cards_owner_all" ON credit_cards
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
