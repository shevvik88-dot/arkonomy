import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim();
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
