-- Closes FINDING-1 (SECURITY_THREAT_MODEL.md, Information Disclosure I6).
--
-- savings_reminders' WITH CHECK only validated auth.uid() = user_id on the
-- reminder row itself — it never checked that goal_id (FK to savings.id)
-- actually belongs to that same user. An attacker could upsert a reminder
-- with their own user_id but another user's real savings.id as goal_id;
-- RLS passed it (their own row's user_id matched). push-notify's batch cron
-- job runs under the service role (RLS bypassed entirely) and does
-- `.select('user_id, goal_id, amount, day_of_week, savings(name)')` — the
-- embedded savings(name) resolves regardless of ownership, and the
-- resulting goal name gets pushed to the attacker's own device via
-- r.user_id. Narrow leak (one text field, requires already knowing a
-- victim's savings.id UUID), but a real, code-confirmed gap.
--
-- Fix: WITH CHECK now also requires goal_id to reference a savings row
-- owned by the same auth.uid(). USING is left unchanged — it only gates
-- which existing rows are visible/actionable (SELECT/DELETE), and those
-- were already correctly scoped by user_id; the integrity gap was strictly
-- a write-time (INSERT/UPDATE) problem.
DROP POLICY IF EXISTS "savings_reminders_owner" ON savings_reminders;

CREATE POLICY "savings_reminders_owner" ON savings_reminders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM savings WHERE savings.id = goal_id AND savings.user_id = auth.uid()
    )
  );
