// Unit tests for _shared/requirePaidPlan.ts — the server-side paid-Pro gate
// for the Alpaca money-path functions (PENETRATION_TEST_PLAN.md 6.4 /
// SECURITY_THREAT_MODEL.md E4). Pure logic: no local stack, no network
// beyond the one-time esm.sh import of the module under test.
//
// Entitlement contract (mirrors src/hooks/usePlan.js): allow iff
// plan === 'pro' AND not inside an active trial window. Fails CLOSED.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { requirePaidPlan } from '../_shared/requirePaidPlan.ts';

const CORS = { 'Access-Control-Allow-Origin': '*' };

/** Minimal stub of the supabase client shape requirePaidPlan uses. */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: () => Promise.resolve(result),
              };
            },
          };
        },
      };
    },
  // deno-lint-ignore no-explicit-any
  } as any;
}

const HOUR = 3600_000;

Deno.test('paid Pro, no trial → allowed (null)', async () => {
  const supa = fakeSupabase({ data: { plan: 'pro', trial_ends_at: null }, error: null });
  assertEquals(await requirePaidPlan(supa, 'u1', CORS), null);
});

Deno.test('paid Pro, trial already ended → allowed (null)', async () => {
  const past = new Date(Date.now() - 24 * HOUR).toISOString();
  const supa = fakeSupabase({ data: { plan: 'pro', trial_ends_at: past }, error: null });
  assertEquals(await requirePaidPlan(supa, 'u1', CORS), null);
});

Deno.test('free plan → 403 upgrade_required', async () => {
  const supa = fakeSupabase({ data: { plan: 'free', trial_ends_at: null }, error: null });
  const res = await requirePaidPlan(supa, 'u1', CORS);
  assertEquals(res?.status, 403);
  assertEquals((await res!.json()).error, 'upgrade_required');
});

Deno.test('Pro but inside active trial → 403 (trial is not paid)', async () => {
  const future = new Date(Date.now() + 3 * 24 * HOUR).toISOString();
  const supa = fakeSupabase({ data: { plan: 'pro', trial_ends_at: future }, error: null });
  const res = await requirePaidPlan(supa, 'u1', CORS);
  assertEquals(res?.status, 403);
  assertEquals((await res!.json()).error, 'upgrade_required');
});

Deno.test('plan missing / null → 403', async () => {
  const supa = fakeSupabase({ data: { plan: null, trial_ends_at: null }, error: null });
  const res = await requirePaidPlan(supa, 'u1', CORS);
  assertEquals(res?.status, 403);
});

Deno.test('fails CLOSED when the profile read errors → 503', async () => {
  const supa = fakeSupabase({ data: null, error: { message: 'db down' } });
  const res = await requirePaidPlan(supa, 'u1', CORS);
  assertEquals(res?.status, 503);
  assertEquals((await res!.json()).error, 'plan_check_failed');
});

Deno.test('fails CLOSED when no row is returned → 503', async () => {
  const supa = fakeSupabase({ data: null, error: null });
  const res = await requirePaidPlan(supa, 'u1', CORS);
  assertEquals(res?.status, 503);
});

Deno.test('trial_ends_at exactly now → not an active trial (strict >)', async () => {
  // The check is `trialEnd.getTime() > Date.now()`. A timestamp equal to (or
  // microseconds before) now must resolve to "trial over" for a paid Pro.
  const supa = fakeSupabase({ data: { plan: 'pro', trial_ends_at: new Date(Date.now() - 5).toISOString() }, error: null });
  assertEquals(await requirePaidPlan(supa, 'u1', CORS), null);
});
