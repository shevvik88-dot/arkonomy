-- plaid_items was created in the Supabase dashboard before the schema
-- migration ran, so the plaid_cursor column was never added.
-- Without this column the sync function cannot store its position cursor,
-- causing every sync to restart from the beginning (full re-fetch).

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS plaid_cursor TEXT;
