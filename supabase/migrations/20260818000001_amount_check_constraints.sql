-- Closes the transactions.amount / savings.target / savings.current CHECK
-- constraint gap (race-condition/input-validation audit, 2026-08-17/18):
-- direct RLS-scoped inserts with negative, zero, or the special Postgres
-- 'NaN' numeric value all succeeded with no error. Confirmed against real
-- production data before applying — 0 violating rows for all three checks
-- (one pre-existing test artifact in transactions, "Negative Amount Test",
-- amount=-50.00, created 2026-07-31, was identified as QA junk and deleted
-- separately before this migration).
--
-- Sign convention confirmed from src/utils/helpers.js's sumAmounts():
-- `type` (income/expense) encodes direction, `amount` is always meant to
-- be stored as a positive value — the comment there documents this exact
-- bug class ("a stray negative-amount expense has previously flipped
-- Net/Budget math inconsistently across screens") already happening once
-- and being patched with defensive Math.abs() at call sites rather than a
-- DB constraint. Confirmed via src/components/Savings.jsx's handleAdd():
-- target > 0 is already an enforced, deliberate UI rule (mirrors
-- Profile.jsx's Financial Settings guard), not a gap this constraint
-- would newly restrict.
--
-- NaN is excluded explicitly (not just `> 0`/`>= 0`) because Postgres
-- numeric treats NaN as greater than any non-NaN value for comparison
-- operators (`'NaN'::numeric > 0` is true) — verified empirically, not
-- assumed, before writing this.
ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_positive
  CHECK (amount > 0 AND amount != 'NaN');

ALTER TABLE savings
  ADD CONSTRAINT savings_current_check
  CHECK (current >= 0 AND current != 'NaN');

ALTER TABLE savings
  ADD CONSTRAINT savings_target_check
  CHECK (target > 0 AND target != 'NaN');
