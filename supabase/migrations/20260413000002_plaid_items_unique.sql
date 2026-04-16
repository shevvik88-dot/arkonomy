-- The plaid-exchange-token function upserts on (user_id, item_id) but
-- the table was created without a unique constraint on that pair.
-- PostgREST requires a unique index for onConflict to work, so the
-- upsert was silently failing and no access_token was ever saved.

ALTER TABLE plaid_items
  ADD CONSTRAINT plaid_items_user_id_item_id_key UNIQUE (user_id, item_id);
