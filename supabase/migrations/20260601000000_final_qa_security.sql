-- Final Security Audit Cleanup
-- 1. Ensure RLS is enabled on all tables that store user data.
-- 2. Add owner-only policies for tables that were missing them in migrations.

-- ── 1. Transactions ─────────────────────────────────────────────────────────
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_owner_all" ON transactions;
CREATE POLICY "transactions_owner_all" ON transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. Savings ──────────────────────────────────────────────────────────────
ALTER TABLE savings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "savings_owner_all" ON savings;
CREATE POLICY "savings_owner_all" ON savings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 3. Categories ───────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_owner_all" ON categories;
CREATE POLICY "categories_owner_all" ON categories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 4. Notification Preferences ─────────────────────────────────────────────
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_prefs_owner_all" ON notification_preferences;
CREATE POLICY "notification_prefs_owner_all" ON notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
