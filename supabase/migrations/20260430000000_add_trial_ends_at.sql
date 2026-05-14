-- Add 7-day trial column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- New users get no automatic trial — trial starts only after Stripe Checkout
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, trial_ends_at)
  VALUES (NEW.id, NEW.email, NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
