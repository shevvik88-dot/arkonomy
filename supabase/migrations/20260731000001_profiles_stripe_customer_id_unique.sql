-- Makes it physically impossible for two profiles to share one
-- stripe_customer_id, not just logically prevented in application code.
-- NULL is allowed to repeat (Postgres UNIQUE never compares NULL = NULL),
-- so free-plan users with no Stripe customer yet are unaffected.
--
-- This does NOT by itself prevent one user from ending up with two active
-- Stripe subscriptions under two different customer ids — that's the
-- stripe-checkout code fix (searches Stripe by email before creating a
-- new session). This constraint is the narrower, complementary guarantee:
-- no accidental/racy cross-user aliasing of the same Stripe customer.
-- Checked live before applying: 0 existing duplicate non-null values.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_stripe_customer_id_unique UNIQUE (stripe_customer_id);
