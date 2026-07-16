import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('plaid-webhook');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Plaid webhook verification uses JWT + ES256, not HMAC.
// Steps: decode kid → fetch Plaid JWK → verify signature → compare body hash.
async function verifyPlaidWebhook(
  rawBody: string,
  token: string,
  plaidBase: string,
  clientId: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    const b64decode = (s: string) =>
      atob(s.replace(/-/g, '+').replace(/_/g, '/'));

    const header  = JSON.parse(b64decode(headerB64));
    const payload = JSON.parse(b64decode(payloadB64));

    const keyRes = await fetch(`${plaidBase}/webhook_verification_key/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, secret, key_id: header.kid }),
    });
    if (!keyRes.ok) return false;
    const { key } = await keyRes.json();

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify'],
    );

    const sigBytes   = Uint8Array.from(b64decode(sigB64), c => c.charCodeAt(0));
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey, sigBytes, signedData,
    );
    if (!valid) return false;

    const bodyHashBuf = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(rawBody),
    );
    const bodyHashHex = Array.from(new Uint8Array(bodyHashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return bodyHashHex === payload.request_body_sha256;
  } catch (err) {
    console.error('plaid-webhook: JWT verification error', err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const rawBody = await req.text();
    const verificationJwt = req.headers.get('plaid-verification');

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    if (!verificationJwt || !(await verifyPlaidWebhook(rawBody, verificationJwt, plaidBase, clientId, secret))) {
      console.error('plaid-webhook: signature verification failed');
      return json({ error: 'Unauthorized' }, 401);
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const webhookType = body.webhook_type as string;
    const webhookCode = body.webhook_code as string;
    const itemId      = body.item_id      as string;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── TRANSACTIONS / SYNC_UPDATES_AVAILABLE ──────────────────────────────────
    if (webhookType === 'TRANSACTIONS' && webhookCode === 'SYNC_UPDATES_AVAILABLE') {
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/plaid-sync-transactions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'sync_item', item_id: itemId }),
        });
      } catch (err) {
        console.error('plaid-webhook: failed to trigger sync for item', itemId, err);
      }
      return json({ received: true });
    }

    // ── ITEM / ERROR ──────────────────────────────────────────────────────────
    if (webhookType === 'ITEM' && webhookCode === 'ERROR') {
      const errorCode = (body.error as Record<string, string>)?.error_code ?? 'UNKNOWN';
      const { error } = await supabase
        .from('plaid_items')
        .update({ error_code: errorCode })
        .eq('item_id', itemId);
      if (error) console.error('plaid-webhook: failed to set error_code', error);
      return json({ received: true });
    }

    // ── All other types — acknowledge and ignore ───────────────────────────────
    return json({ received: true });
  } catch (err) {
    console.error('plaid-webhook error:', err);
    await captureAndFlush(err, { function_name: 'plaid-webhook' });
    return json({ error: 'Internal Server Error' }, 500);
  }
});
