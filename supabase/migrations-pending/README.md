# Deferred migrations

Migrations staged here are **not applied** by `supabase db push` / `supabase
migration up` — the CLI only reads the top-level `supabase/migrations/`
directory. Each file here has a prerequisite that must be met first
(documented in its header comment). When the prerequisite holds, move the
file into `supabase/migrations/` unchanged (keep the timestamped name),
review the SQL with a human, apply to a disposable/local project, then
production.

| File | Prerequisite |
|---|---|
| `20260907000003_investments_drop_window_bucket.sql` | New `alpaca-invest` handler from PHASE A (`20260907000001_investments_stable_idempotency.sql`) confirmed live in production and exercised. |
