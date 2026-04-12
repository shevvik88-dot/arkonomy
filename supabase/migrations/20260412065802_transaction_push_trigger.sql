-- Enable pg_net for async HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Trigger function ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_push_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget          NUMERIC;
  v_monthly_spent   NUMERIC;
  v_push_sub        JSONB;
  v_large_threshold NUMERIC := 200;
  v_url             TEXT    := 'https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/push-notify';
  v_key             TEXT    := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2bmt4eGF6amZlc2J4ZGt6dWJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzAyODM2NSwiZXhwIjoyMDg4NjA0MzY1fQ.b7YEEFlcpjQjzqcqluGnolwygmm3Havhf3U2whsDS5E';
BEGIN
  -- Only alert on expense inserts (skip income and transfers)
  IF NEW.type != 'expense' OR NEW.category_name = 'Transfer' THEN
    RETURN NEW;
  END IF;

  -- Read user's push subscription and budget from profiles
  SELECT
    COALESCE(monthly_budget, 3000),
    push_subscription
  INTO v_budget, v_push_sub
  FROM profiles
  WHERE id = NEW.user_id;

  -- No subscription registered — nothing to send
  IF v_push_sub IS NULL THEN
    RETURN NEW;
  END IF;

  -- Current month's total expenses (trigger fires AFTER INSERT so this includes the new row)
  SELECT COALESCE(SUM(amount::NUMERIC), 0)
  INTO v_monthly_spent
  FROM transactions
  WHERE user_id       = NEW.user_id
    AND type          = 'expense'
    AND category_name != 'Transfer'
    AND date          >= DATE_TRUNC('month', CURRENT_DATE)::DATE;

  -- ── Alert 1: large transaction ────────────────────────────────────────────
  IF NEW.amount::NUMERIC > v_large_threshold THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'user_id', NEW.user_id::TEXT,
        'title',   'Large Transaction',
        'body',    '$' || ROUND(NEW.amount::NUMERIC, 2)::TEXT
                     || ' added to '
                     || COALESCE(NEW.category_name, 'Uncategorized'),
        'icon',    '/icon-192.png',
        'tag',     'large-tx'
      )
    );
  END IF;

  -- ── Alert 2: budget exceeded ──────────────────────────────────────────────
  IF v_monthly_spent > v_budget THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'user_id', NEW.user_id::TEXT,
        'title',   'Budget Exceeded',
        'body',    'Monthly spending ($'
                     || ROUND(v_monthly_spent)::TEXT
                     || ') exceeds your $'
                     || ROUND(v_budget)::TEXT
                     || ' budget',
        'icon',    '/icon-192.png',
        'tag',     'budget-exceeded'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate to avoid duplicate triggers across deploys
DROP TRIGGER IF EXISTS on_transaction_insert ON transactions;

CREATE TRIGGER on_transaction_insert
  AFTER INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_push_on_transaction();
