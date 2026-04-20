-- savings_reminders: weekly transfer reminders for linked savings goals.
-- day_of_week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat (JS getDay() convention)

CREATE TABLE savings_reminders (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  goal_id     UUID          NOT NULL REFERENCES savings(id) ON DELETE CASCADE,
  day_of_week SMALLINT      NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (user_id, goal_id)
);

ALTER TABLE savings_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "savings_reminders_owner" ON savings_reminders
  FOR ALL USING  (auth.uid() = user_id)
  WITH CHECK     (auth.uid() = user_id);
