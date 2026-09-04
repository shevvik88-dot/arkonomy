-- The plaid-exchange-token function upserts on (user_id, item_id) but
-- the table was created without a unique constraint on that pair.
-- PostgREST requires a unique index for onConflict to work, so the
-- upsert was silently failing and no access_token was ever saved.
--
-- Guarded because 20260413000000_plaid_schema.sql already declares an
-- inline `UNIQUE (user_id, item_id)` on CREATE TABLE, which Postgres
-- auto-names `plaid_items_user_id_item_id_key`. On a fresh replay that
-- constraint already exists here, so a bare ADD CONSTRAINT aborts with
-- 42P07 `relation "plaid_items_user_id_item_id_key" already exists`.
-- On production the CREATE TABLE was a no-op (table pre-made in the
-- dashboard without the constraint), so this ALTER is what actually
-- added it there. Both cases are covered by the existence check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.plaid_items'::regclass
      AND conname  = 'plaid_items_user_id_item_id_key'
  ) THEN
    ALTER TABLE plaid_items
      ADD CONSTRAINT plaid_items_user_id_item_id_key UNIQUE (user_id, item_id);
  END IF;
END $$;
