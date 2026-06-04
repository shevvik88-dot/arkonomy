-- Fix RLS token exposure and cleanup duplicate policies

-- 1. Remove client SELECT access to plaid_items to protect access_token
-- All Plaid operations are handled server-side via Edge Functions.
DROP POLICY IF EXISTS "users_read_own_plaid_items" ON plaid_items;

-- 2. Clean up duplicate and overly broad policies on profiles
-- (As identified in SECURITY_AUDIT.md and SECURITY_AUDIT_2.md)
-- We keep only the specific owner policies.
DROP POLICY IF EXISTS "profiles_owner_select" ON profiles;
DROP POLICY IF EXISTS "profiles_owner_update" ON profiles;

-- Re-create restricted profile policies
CREATE POLICY "profiles_owner_select" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_owner_update" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 3. Ensure sensitive columns in profiles are NOT exposed if possible.
-- Since Supabase RLS is row-level, we recommend moving secrets to a separate table
-- or using a VIEW. For now, we will at least ensure no other broad policies exist.

-- 4. Audit and fix investments policies if they exist (cleanup broad ALL grants)
-- If investments table exists, ensure it has specific policies.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'investments') THEN
        DROP POLICY IF EXISTS "investments_owner_all" ON investments;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investments' AND policyname = 'investments_owner_select') THEN
            CREATE POLICY investments_owner_select ON investments FOR SELECT USING (auth.uid() = user_id);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'investments' AND policyname = 'investments_owner_insert') THEN
            CREATE POLICY investments_owner_insert ON investments FOR INSERT WITH CHECK (auth.uid() = user_id);
        END IF;
    END IF;
END $$;
