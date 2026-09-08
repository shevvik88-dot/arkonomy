// Integration tests for stripe-webhook — real local Supabase stack, real
// HMAC signature verification (no Stripe network call is made by this
// handler; constructEventAsync is pure crypto).
//
// Covers: FINDING-B event_id idempotency (a redelivered event must not
// re-extend the trial), signature rejection, and each subscription
// lifecycle branch's plan + brokerage-token effects.
//
// Requires `npx supabase start`.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { STRIPE_WEBHOOK_SECRET } from './_helpers/mod.ts';
import { createTestUser } from './_helpers/mod.ts';
import { dbAdmin } from './_helpers/mod.ts';
import { handler } from '../stripe-webhook/index.ts';

const enc = new TextEncoder();

async function stripeSig(payload: string, secret = STRIPE_WEBHOOK_SECRET): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

function evt(
  type: string,
  obj: Record<string, unknown>,
  opts: { id?: string; created?: number } = {},
): { id: string; created: number; payload: string } {
  const id = opts.id ?? `evt_${crypto.randomUUID()}`;
  // event.created (Stripe event emission time, Unix seconds) — distinct
  // from data.object.created (e.g. a Checkout Session's own creation).
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  return { id, created, payload: JSON.stringify({ id, object: 'event', type, created, data: { object: obj } }) };
}

async function post(payload: string, sig?: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const s = sig === undefined ? await stripeSig(payload) : sig;
  if (s) headers['stripe-signature'] = s;
  return handler(new Request('http://localhost/stripe-webhook', { method: 'POST', headers, body: payload }));
}

async function delEvents(...ids: string[]) {
  if (ids.length) await dbAdmin().from('stripe_webhook_events').delete().in('event_id', ids);
}

function profile(id: string) {
  return dbAdmin().from('profiles').select('*').eq('id', id).single();
}

Deno.test('checkout.session.completed → profile upgraded to Pro trial', async () => {
  const user = await createTestUser({ plan: 'free', profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_1' } });
  const cust = `cus_${crypto.randomUUID()}`;
  // A real checkout.session.completed carries the session's own id in
  // data.object.id — the guard-clear is scoped to it.
  const e = evt('checkout.session.completed', { id: 'cs_1', client_reference_id: user.id, customer: cust });
  try {
    const res = await post(e.payload);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).received, true);

    const { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'pro');
    assertEquals(p!.stripe_customer_id, cust);
    assertEquals(p!.checkout_pending_at, null);
    assertEquals(p!.checkout_session_id, null);
    const days = (new Date(p!.trial_ends_at).getTime() - Date.now()) / 86_400_000;
    assert(days > 6.9 && days < 7.1, `trial_ends_at ~7d, got ${days}`);
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('FINDING-B: the same event.id delivered twice does not re-extend the trial', async () => {
  const user = await createTestUser({ plan: 'free' });
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: `cus_${crypto.randomUUID()}` });
  try {
    const r1 = await post(e.payload);
    assertEquals(r1.status, 200);
    assertEquals((await r1.json()).duplicate, undefined);
    const { data: after1 } = await profile(user.id);

    const r2 = await post(e.payload); // byte-identical redelivery
    assertEquals(r2.status, 200);
    assertEquals((await r2.json()).duplicate, true);
    const { data: after2 } = await profile(user.id);

    assertEquals(after2!.trial_ends_at, after1!.trial_ends_at); // not pushed out

    const { data: rows } = await dbAdmin().from('stripe_webhook_events').select('event_id').eq('event_id', e.id);
    assertEquals(rows!.length, 1);
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('FINDING-B: two concurrent deliveries of one event → side effect applied once', async () => {
  const user = await createTestUser({ plan: 'free' });
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: `cus_${crypto.randomUUID()}` });
  try {
    const [a, b] = await Promise.all([post(e.payload), post(e.payload)]);
    const bodies = [await a.json(), await b.json()];
    const dupes = bodies.filter((x) => x.duplicate === true).length;
    assertEquals(dupes, 1); // exactly one short-circuited on the 23505

    const { data: rows } = await dbAdmin().from('stripe_webhook_events').select('event_id').eq('event_id', e.id);
    assertEquals(rows!.length, 1);
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('signature: a bad signature is rejected 400 with no dedup row and no profile change', async () => {
  const user = await createTestUser({ plan: 'free' });
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: 'cus_x' });
  try {
    const bad = await post(e.payload, 't=1,v1=deadbeef');
    assertEquals(bad.status, 400);

    const missing = await post(e.payload, null);
    assertEquals(missing.status, 400);

    const { data: rows } = await dbAdmin().from('stripe_webhook_events').select('event_id').eq('event_id', e.id);
    assertEquals(rows!.length, 0);
    const { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'free');
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('config: missing STRIPE_WEBHOOK_SECRET → 500', async () => {
  const saved = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
  Deno.env.delete('STRIPE_WEBHOOK_SECRET');
  try {
    const e = evt('checkout.session.completed', { client_reference_id: 'u', customer: 'c' });
    const res = await post(e.payload, 't=1,v1=x');
    assertEquals(res.status, 500);
  } finally {
    Deno.env.set('STRIPE_WEBHOOK_SECRET', saved);
  }
});

Deno.test('customer.subscription.deleted → downgraded to free and Alpaca token cleared', async () => {
  const cust = `cus_${crypto.randomUUID()}`;
  const user = await createTestUser({
    plan: 'pro',
    trialEndsAt: new Date(Date.now() + 5 * 86_400_000),
    profile: { stripe_customer_id: cust, alpaca_access_token: 'tok', alpaca_refresh_token: 'ref', alpaca_account_id: 'acct', alpaca_connected_at: new Date().toISOString() },
  });
  const e = evt('customer.subscription.deleted', { customer: cust, status: 'canceled' });
  try {
    const res = await post(e.payload);
    assertEquals(res.status, 200);
    const { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'free');
    assertEquals(p!.trial_ends_at, null);
    assertEquals(p!.alpaca_access_token, null);
    assertEquals(p!.alpaca_refresh_token, null);
    assertEquals(p!.alpaca_account_id, null);
    assertEquals(p!.alpaca_connected_at, null);
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('invoice.payment_failed: terminal (no next attempt) downgrades; retriable does not', async () => {
  const cust = `cus_${crypto.randomUUID()}`;
  const user = await createTestUser({ plan: 'pro', profile: { stripe_customer_id: cust, alpaca_access_token: 'tok' } });
  const retriable = evt('invoice.payment_failed', { customer: cust, next_payment_attempt: Math.floor(Date.now() / 1000) + 86_400 });
  const terminal = evt('invoice.payment_failed', { customer: cust, next_payment_attempt: null });
  try {
    await post(retriable.payload);
    let { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'pro');
    assertEquals(p!.alpaca_access_token, 'tok');

    await post(terminal.payload);
    ({ data: p } = await profile(user.id));
    assertEquals(p!.plan, 'free');
    assertEquals(p!.alpaca_access_token, null);
  } finally {
    await delEvents(retriable.id, terminal.id);
    await user.cleanup();
  }
});

Deno.test('invoice.payment_succeeded: subscription_cycle with a real charge clears the trial', async () => {
  const cust = `cus_${crypto.randomUUID()}`;
  const user = await createTestUser({ plan: 'pro', trialEndsAt: new Date(Date.now() + 5 * 86_400_000), profile: { stripe_customer_id: cust } });
  const zero = evt('invoice.payment_succeeded', { customer: cust, billing_reason: 'subscription_create', amount_paid: 0 });
  const cycle = evt('invoice.payment_succeeded', { customer: cust, billing_reason: 'subscription_cycle', amount_paid: 900 });
  try {
    await post(zero.payload);
    let { data: p } = await profile(user.id);
    assert(p!.trial_ends_at !== null); // $0 trial invoice: unchanged

    await post(cycle.payload);
    ({ data: p } = await profile(user.id));
    assertEquals(p!.trial_ends_at, null);
  } finally {
    await delEvents(zero.id, cycle.id);
    await user.cleanup();
  }
});

Deno.test('checkout.session.expired → checkout guard fields cleared', async () => {
  const user = await createTestUser({ plan: 'free', profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_exp' } });
  const e = evt('checkout.session.expired', { id: 'cs_exp', client_reference_id: user.id });
  try {
    const res = await post(e.payload);
    assertEquals(res.status, 200);
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_pending_at, null);
    assertEquals(p!.checkout_session_id, null);
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: an old session expiring does not clear a newer session\'s lock', async () => {
  // The user's stored checkout_session_id has since moved on to 'cs_new'
  // (a second checkout started after 'cs_old' was created) — 'cs_old's
  // own expiry event, arriving late, must not release that newer lock.
  const user = await createTestUser({ plan: 'free', profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_new' } });
  const e = evt('checkout.session.expired', { id: 'cs_old', client_reference_id: user.id });
  try {
    const res = await post(e.payload);
    assertEquals(res.status, 200);
    const { data: p } = await profile(user.id);
    assert(p!.checkout_pending_at !== null); // still locked
    assertEquals(p!.checkout_session_id, 'cs_new'); // untouched
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a DB failure applying the effect fails the delivery and does not stick', async () => {
  // profiles.stripe_customer_id is UNIQUE — colliding with an existing
  // customer id is a real DB error, not a mock.
  const clash = `cus_${crypto.randomUUID()}`;
  const other = await createTestUser({ plan: 'free', profile: { stripe_customer_id: clash } });
  const user  = await createTestUser({ plan: 'free' });
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: clash });
  try {
    const failed = await post(e.payload);
    assertEquals(failed.status, 500); // not a false 200 after the write actually failed

    const { data: after } = await profile(user.id);
    assertEquals(after!.plan, 'free'); // not upgraded

    const { data: rows } = await dbAdmin().from('stripe_webhook_events').select('event_id').eq('event_id', e.id);
    assertEquals(rows!.length, 0); // dedup row cleaned up, not left stuck at 'processing'

    // Retry with the collision resolved — same event.id must actually
    // reapply this time, not be told "duplicate".
    await dbAdmin().from('profiles').update({ stripe_customer_id: null }).eq('id', other.id);
    const retried = await post(e.payload);
    assertEquals(retried.status, 200);
    assertEquals((await retried.json()).duplicate, undefined);
    const { data: afterRetry } = await profile(user.id);
    assertEquals(afterRetry!.plan, 'pro');
  } finally {
    await delEvents(e.id);
    await other.cleanup();
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a stale processing row (crashed prior attempt) is retried, not treated as duplicate', async () => {
  const user = await createTestUser({ plan: 'free' });
  const cust = `cus_${crypto.randomUUID()}`;
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: cust });
  try {
    // Simulate a previous attempt that inserted the dedup row and then
    // crashed before ever reaching the profile update or its own cleanup.
    await dbAdmin().from('stripe_webhook_events').insert({
      event_id: e.id, status: 'processing', processed_at: new Date(Date.now() - 61_000).toISOString(),
    });

    const res = await post(e.payload);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).duplicate, undefined); // actually reapplied, not acked as a no-op

    const { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'pro');

    const { data: rows } = await dbAdmin().from('stripe_webhook_events').select('status').eq('event_id', e.id).single();
    assertEquals(rows!.status, 'completed');
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a fresh processing row (genuinely concurrent) is acked without reapplying', async () => {
  const user = await createTestUser({ plan: 'free' });
  const cust = `cus_${crypto.randomUUID()}`;
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: cust });
  try {
    // A few milliseconds old — well under the staleness window, i.e. a
    // delivery that's genuinely still in flight right now elsewhere.
    await dbAdmin().from('stripe_webhook_events').insert({ event_id: e.id, status: 'processing' });

    const res = await post(e.payload);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).duplicate, true);

    const { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'free'); // not applied by this (losing) delivery
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-08: two concurrent stale-processing retries apply the effect once, do not extend the trial', async () => {
  const user = await createTestUser({ plan: 'free' });
  const cust = `cus_${crypto.randomUUID()}`;
  // `created` fixed and in the past so the derived trial_ends_at is a
  // stable value both retries must compute identically.
  const created = Math.floor(Date.now() / 1000) - 3600;
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: cust, created });
  try {
    // A crashed prior attempt: dedup row inserted, processed_at well past
    // the staleness window, side effect never confirmed.
    await dbAdmin().from('stripe_webhook_events').insert({
      event_id: e.id, status: 'processing', processed_at: new Date(Date.now() - 120_000).toISOString(),
    });

    const [a, b] = await Promise.all([post(e.payload), post(e.payload)]);
    const bodies = [await a.json(), await b.json()];
    // Exactly one retry claims the stale row (CAS on processed_at) and
    // re-runs; the other loses the claim and acks as a duplicate.
    assertEquals(bodies.filter((x) => x.duplicate === true).length, 1);
    assertEquals([a.status, b.status].sort(), [200, 200]);

    const { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'pro');
    // trial_ends_at === created + 7d exactly — not now()+7d, and not
    // pushed further by the second retry.
    assertEquals(
      new Date(p!.trial_ends_at).getTime(),
      (created + 7 * 24 * 60 * 60) * 1000,
    );

    const { data: row } = await dbAdmin().from('stripe_webhook_events').select('status').eq('event_id', e.id).single();
    assertEquals(row!.status, 'completed');
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-08: a crash between the profile update and the completed mark does not extend the trial on redelivery', async () => {
  const created = Math.floor(Date.now() / 1000) - 7200;
  const expectedTrialEndMs = (created + 7 * 24 * 60 * 60) * 1000;
  const cust = `cus_${crypto.randomUUID()}`;
  // The user is ALREADY on the trial the first attempt granted — it updated
  // profiles, then crashed before writing status='completed'.
  const user = await createTestUser({
    plan: 'pro',
    profile: { trial_ends_at: new Date(expectedTrialEndMs).toISOString(), stripe_customer_id: cust },
  });
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: cust, created });
  try {
    await dbAdmin().from('stripe_webhook_events').insert({
      event_id: e.id, status: 'processing', processed_at: new Date(Date.now() - 300_000).toISOString(),
    });

    const res = await post(e.payload); // Stripe redelivers minutes later
    assertEquals(res.status, 200);

    const { data: p } = await profile(user.id);
    // Re-running the side effect is a true no-op: the value is derived from
    // session.created, so it lands on the same instant already stored — not
    // pushed ~2h further out (which Date.now()+7d would have done).
    assertEquals(new Date(p!.trial_ends_at).getTime(), expectedTrialEndMs);
    assertEquals(p!.plan, 'pro');

    const { data: row } = await dbAdmin().from('stripe_webhook_events').select('status').eq('event_id', e.id).single();
    assertEquals(row!.status, 'completed');
  } finally {
    await delEvents(e.id);
    await user.cleanup();
  }
});

Deno.test('independent review #97 P1b: a redelivered stale checkout.session.completed does not overwrite a newer cancellation', async () => {
  const cust = `cus_${crypto.randomUUID()}`;
  const nowS = Math.floor(Date.now() / 1000);
  const user = await createTestUser({ plan: 'free', profile: { checkout_session_id: 'cs_p1b' } });

  // E1: checkout completed at T-300s. It applied plan=pro, then the isolate
  // died before marking its dedup row 'completed'.
  const e1 = evt('checkout.session.completed',
    { client_reference_id: user.id, customer: cust, id: 'cs_p1b', created: nowS - 300 },
    { created: nowS - 300 });
  // E2: subscription cancelled at T-120s → plan=free.
  const e2 = evt('customer.subscription.deleted', { customer: cust, status: 'canceled' }, { created: nowS - 120 });

  try {
    // Replay real history: E1 applied then crashed; E2 applied.
    await post(e1.payload);
    await dbAdmin().from('stripe_webhook_events')
      .update({ status: 'processing', processed_at: new Date(Date.now() - 300_000).toISOString() })
      .eq('event_id', e1.id); // simulate the crash — dedup row left 'processing'
    await post(e2.payload);

    let { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'free', 'E2 (cancellation) applied');

    // Stripe redelivers E1 (older event, stale processing row).
    const res = await post(e1.payload);
    assertEquals(res.status, 200);

    ({ data: p } = await profile(user.id));
    assertEquals(p!.plan, 'free', 'the redelivered older completed event must NOT re-grant pro');
  } finally {
    await delEvents(e1.id, e2.id);
    await user.cleanup();
  }
});

Deno.test('independent review #97 P1b: normal ordering still applies (completed then a later invoice)', async () => {
  const cust = `cus_${crypto.randomUUID()}`;
  const nowS = Math.floor(Date.now() / 1000);
  const user = await createTestUser({ plan: 'free' });
  const completed = evt('checkout.session.completed',
    { client_reference_id: user.id, customer: cust, created: nowS - 60 },
    { created: nowS - 60 });
  const cycle = evt('invoice.payment_succeeded',
    { customer: cust, billing_reason: 'subscription_cycle', amount_paid: 2000 },
    { created: nowS });
  try {
    await post(completed.payload);
    let { data: p } = await profile(user.id);
    assertEquals(p!.plan, 'pro');
    assert(p!.trial_ends_at !== null);

    await post(cycle.payload); // newer event — must apply
    ({ data: p } = await profile(user.id));
    assertEquals(p!.trial_ends_at, null, 'the later subscription_cycle cleared the trial');
    assertEquals(p!.plan, 'pro');
  } finally {
    await delEvents(completed.id, cycle.id);
    await user.cleanup();
  }
});

Deno.test('checkout.session.completed for an unknown user → 200, no crash', async () => {
  const e = evt('checkout.session.completed', { client_reference_id: crypto.randomUUID(), customer: 'cus_ghost' });
  try {
    const res = await post(e.payload);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).received, true);
  } finally {
    await delEvents(e.id);
  }
});

Deno.test('unknown event type → 200 received, no-op', async () => {
  const e = evt('payment_intent.succeeded', { id: 'pi_1' });
  try {
    const res = await post(e.payload);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).received, true);
  } finally {
    await delEvents(e.id);
  }
});
