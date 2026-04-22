-- Migrate savings_reminders.day_of_week from SMALLINT to SMALLINT[]
-- so users can pick multiple reminder days per goal.

-- 1. Drop the single-value range constraint
ALTER TABLE savings_reminders
  DROP CONSTRAINT savings_reminders_day_of_week_check;

-- 2. Cast the existing single value into a one-element array
ALTER TABLE savings_reminders
  ALTER COLUMN day_of_week TYPE SMALLINT[]
  USING ARRAY[day_of_week];

-- 3. Ensure the array is never empty
ALTER TABLE savings_reminders
  ADD CONSTRAINT savings_reminders_days_nonempty
  CHECK (array_length(day_of_week, 1) > 0);
