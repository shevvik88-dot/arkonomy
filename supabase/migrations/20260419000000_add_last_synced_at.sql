-- Add last_synced_at to profiles so the app can display "Last synced: X ago"
-- and the batch-sync cron job can update it after each daily run.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
