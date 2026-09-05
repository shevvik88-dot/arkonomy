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

function evt(type: string, obj: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`): { id: string; payload: string } {
  return { id, payload: JSON.stringify({ id, object: 'event', type, data: { object: obj } }) };
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
  const e = evt('checkout.session.completed', { client_reference_id: user.id, customer: cust });
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
  const e = evt('checkout.session.expired', { client_reference_id: user.id });
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
