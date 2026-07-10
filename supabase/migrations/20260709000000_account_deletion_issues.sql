-- account_deletion_issues: audit trail for account deletions where the
-- Stripe subscription cancel and/or Plaid item revoke failed. The account
-- deletion itself proceeds regardless (user_id is NOT a FK to auth.users —
-- that row is about to be deleted, so no ON DELETE CASCADE here, or this
-- table would lose its own record the moment it's needed).
--
-- No SELECT policy for anon/authenticated — service-role only, same posture
-- as plaid_items/plaid_accounts. Read via Supabase dashboard/service role
-- for manual follow-up (e.g. issuing a refund, manually cancelling in
-- Stripe Dashboard).

CREATE TABLE IF NOT EXISTS account_deletion_issues (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL,
  user_email         TEXT,
  stripe_customer_id TEXT,
  stripe_error       TEXT,
  plaid_item_ids     TEXT[],
  plaid_error        TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE account_deletion_issues ENABLE ROW LEVEL SECURITY;
