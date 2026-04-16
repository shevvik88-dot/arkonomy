-- Add Stripe customer ID and plan tracking to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Index for webhook lookups by customer ID
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON profiles (stripe_customer_id);
