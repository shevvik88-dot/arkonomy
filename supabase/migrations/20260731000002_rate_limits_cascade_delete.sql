-- rate_limits.user_id had no FK to auth.users at all — confirmed live
-- during an account-deletion test that it survives delete-account
-- untouched (delete-account doesn't explicitly delete it, and there was
-- no CASCADE to catch it automatically, unlike merchant_aliases/
-- scheduled_payments/oauth_nonces which are safe for the same reason this
-- one wasn't). Found a real pre-existing orphaned row in production from a
-- user deleted before this fix existed — not just a testing artifact.
--
-- FK + ON DELETE CASCADE instead of an explicit DELETE in delete-account's
-- code, per instruction: protects any future table with a user_id column
-- automatically, rather than depending on every new table being manually
-- added to delete-account's explicit delete list.

DELETE FROM public.rate_limits rl
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = rl.user_id);

ALTER TABLE public.rate_limits
  ADD CONSTRAINT rate_limits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
