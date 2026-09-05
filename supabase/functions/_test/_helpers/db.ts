// Service-role Supabase client for test setup/teardown and row assertions.
// Bypasses RLS on purpose — tests use this to arrange fixtures and to read
// back what a handler wrote. The handler itself builds its own client from
// the env vars setup.ts populates; this is only for the test body.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCachedConfig } from './localStack.ts';

let client: SupabaseClient | null = null;

export function dbAdmin(): SupabaseClient {
  if (client) return client;
  const cfg = getCachedConfig();
  client = createClient(cfg.apiUrl, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
