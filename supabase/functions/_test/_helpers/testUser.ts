// Creates a throwaway Supabase Auth user + its profiles row for a test,
// and hands back a real access token plus a cleanup() that deletes the
// user (ON DELETE CASCADE removes profiles / investments / plaid_items).
//
// NEVER touches the maintainer's real account (shevvik88@gmail.com /
// 90eb11c3-...). Emails use the RFC 2606 .invalid TLD so nothing is ever
// deliverable. Same approach as scripts/_lib-disposable-account.mjs.

import { getCachedConfig } from './localStack.ts';
import { dbAdmin } from './db.ts';

export interface TestUserOpts {
  /** profiles.plan — defaults to 'free'. */
  plan?: 'free' | 'pro';
  /** profiles.trial_ends_at — Date, or null (no trial). Omit for null. */
  trialEndsAt?: Date | null;
  /** Any additional profiles columns to set on creation. */
  profile?: Record<string, unknown>;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Real user JWT — accepted by supabase.auth.getUser() on the local stack. */
  accessToken: string;
  cleanup: () => Promise<void>;
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function createTestUser(opts: TestUserOpts = {}): Promise<TestUser> {
  const cfg = getCachedConfig();
  const email = `arkonomy-edgetest-${rand()}@arkonomy-test.invalid`;
  const password = 'Pw_' + rand() + 'Aa1!';

  // 1. Auth user via Admin API
  const createRes = await fetch(`${cfg.apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!createRes.ok) {
    throw new Error(`createTestUser: admin createUser failed ${createRes.status}: ${await createRes.text()}`);
  }
  const { id } = await createRes.json() as { id: string };

  // 2. profiles row (no signup trigger exists — see baseline_profiles migration)
  const profileRow: Record<string, unknown> = {
    id,
    email,
    plan: opts.plan ?? 'free',
    trial_ends_at: opts.trialEndsAt ? opts.trialEndsAt.toISOString() : null,
    ...opts.profile,
  };
  const { error: profErr } = await dbAdmin().from('profiles').upsert(profileRow, { onConflict: 'id' });
  if (profErr) throw new Error(`createTestUser: profiles upsert failed: ${profErr.message}`);

  // 3. Real access token via password grant
  const tokenRes = await fetch(`${cfg.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!tokenRes.ok) {
    throw new Error(`createTestUser: password grant failed ${tokenRes.status}: ${await tokenRes.text()}`);
  }
  const { access_token } = await tokenRes.json() as { access_token: string };

  return {
    id,
    email,
    password,
    accessToken: access_token,
    async cleanup() {
      // investments.user_id → auth.users is NO ACTION (not CASCADE), so a
      // leftover order row blocks the user delete. profiles (→ transactions)
      // and plaid_items (→ plaid_accounts) do cascade from auth.users.
      await dbAdmin().from('investments').delete().eq('user_id', id);

      const res = await fetch(`${cfg.apiUrl}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`cleanup: deleteUser failed ${res.status}: ${await res.text()}`);
      }
    },
  };
}
