// supabase/functions/alpaca-oauth-start/index.ts
// Issues a short-lived, single-use opaque nonce for the Alpaca OAuth `state`
// parameter, instead of the client passing its own Supabase JWT through the
// URL (a live bearer credential in a third party's access logs, browser
// history, and Referer headers). alpaca-oauth-callback resolves the nonce
// back to a user_id server-side.
//
// POST {} with user Bearer token
// → { nonce: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('alpaca-oauth-start');

const NONCE_TTL_MS = 5 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

    if (authErr || !user) {
      return json({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const nonce = crypto.randomUUID();
    const expires_at = new Date(Date.now() + NONCE_TTL_MS).toISOString();

    const { error: insertErr } = await supabase
      .from('oauth_nonces')
      .insert({ nonce, user_id: user.id, expires_at });

    if (insertErr) {
      console.error('[alpaca-oauth-start] insert error:', insertErr);
      await captureAndFlush(new Error('oauth_nonces insert failed'), { function_name: 'alpaca-oauth-start' });
      return json({ error: 'Could not start Alpaca connection' }, 500, corsHeaders);
    }

    return json({ nonce }, 200, corsHeaders);
  } catch (err) {
    console.error('[alpaca-oauth-start] exception:', err);
    await captureAndFlush(err, { function_name: 'alpaca-oauth-start' });
    return json({ error: 'Internal error' }, 500, corsHeaders);
  }
});
