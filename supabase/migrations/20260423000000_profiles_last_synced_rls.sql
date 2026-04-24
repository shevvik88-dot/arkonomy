-- Ensure last_synced_at column exists on profiles (idempotent)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Ensure authenticated users can read and update their own profile row.
-- This is needed for bgSync to read/write last_synced_at via the anon client.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_owner_select'
  ) THEN
    CREATE POLICY profiles_owner_select ON profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_owner_update'
  ) THEN
    CREATE POLICY profiles_owner_update ON profiles
      FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- Enable RLS if not already enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
