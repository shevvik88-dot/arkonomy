-- Add tutorial_completed flag to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tutorial_completed BOOLEAN NOT NULL DEFAULT false;
