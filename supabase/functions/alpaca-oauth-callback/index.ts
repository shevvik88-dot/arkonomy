// alpaca-oauth-callback
// Receives ?code=xxx&state=xxx from Alpaca OAuth redirect,
// exchanges the code for tokens, stores them in profiles,
// then redirects to https://app.arkonomy.com?alpaca_connected=true
//
// Required Supabase secrets:
//   ALPACA_CLIENT_ID
//   ALPACA_CLIENT_SECRET
//   ALPACA_REDIRECT_URI  (e.g. https://app.arkonomy.com/alpaca-callback)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('alpaca-oauth-callback');

const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // opaque nonce from alpaca-oauth-start, resolved to a user below
    const error = url.searchParams.get('error');

    // Alpaca OAuth errors
    if (error) {
      const desc = url.searchParams.get('error_description') ?? error;
      console.error('[alpaca-oauth-callback] OAuth error:', desc);
      return Response.redirect(`${APP_URL}?alpaca_error=${encodeURIComponent(desc)}`, 302);
    }

    if (!code || !state) {
      return Response.redirect(`${APP_URL}?alpaca_error=missing_code`, 302);
    }

    const CLIENT_ID     = Deno.env.get('ALPACA_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('ALPACA_CLIENT_SECRET');
    const REDIRECT_URI  = Deno.env.get('ALPACA_REDIRECT_URI');

    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
      console.error('[alpaca-oauth-callback] Missing env vars');
      return Response.redirect(`${APP_URL}?alpaca_error=server_misconfigured`, 302);
    }

    // ── 1. Exchange code for tokens ───────────────────────────────
    let tokens: { access_token: string; refresh_token: string };
    try {
      const tokenRes = await fetch('https://api.alpaca.markets/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri:  REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        console.error('[alpaca-oauth-callback] Token exchange failed:', body);
        await captureAndFlush(new Error('Token exchange failed'), { function_name: 'alpaca-oauth-callback' });
        return Response.redirect(`${APP_URL}?alpaca_error=token_exchange_failed`, 302);
      }

      tokens = await tokenRes.json();
    } catch (err) {
      console.error('[alpaca-oauth-callback] Fetch error:', err);
      await captureAndFlush(err, { function_name: 'alpaca-oauth-callback' });
      return Response.redirect(`${APP_URL}?alpaca_error=network_error`, 302);
    }

    // ── 2. Fetch Alpaca account ID ────────────────────────────────
    let alpacaAccountId: string | null = null;
    try {
      const acctRes = await fetch('https://api.alpaca.markets/v2/account', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (acctRes.ok) {
        const acct = await acctRes.json();
        alpacaAccountId = acct.id ?? null;
      }
    } catch (_) {
      // Non-fatal — account ID is nice-to-have
    }

    // ── 3. Resolve the Arkonomy user from the nonce ────────────────
    // `state` is an opaque nonce issued by alpaca-oauth-start, not a JWT —
    // it never leaves our own DB, unlike a bearer token, which would have
    // been readable from Alpaca's access logs, browser history, and Referer
    // headers on any subsequent navigation.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: nonceRow, error: nonceErr } = await supabase
      .from('oauth_nonces')
      .select('user_id, expires_at')
      .eq('nonce', state)
      .maybeSingle();

    // Single-use: delete immediately on lookup, valid or not, so a captured
    // callback URL can't be replayed even within the TTL window.
    await supabase.from('oauth_nonces').delete().eq('nonce', state);
    // Opportunistic cleanup of any other expired nonces — no cron needed
    // for a table this small and short-lived.
    await supabase.from('oauth_nonces').delete().lt('expires_at', new Date().toISOString());

    if (nonceErr || !nonceRow || new Date(nonceRow.expires_at) < new Date()) {
      console.error('[alpaca-oauth-callback] Could not resolve user from state:', nonceErr?.message ?? 'nonce missing/expired');
      await captureAndFlush(new Error('Could not resolve user from state'), { function_name: 'alpaca-oauth-callback' });
      return Response.redirect(`${APP_URL}?alpaca_error=auth_failed`, 302);
    }

    const userId = nonceRow.user_id;

    // ── 4. Store tokens in profiles ──────────────────────────────
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({
        alpaca_access_token:  tokens.access_token,
        alpaca_refresh_token: tokens.refresh_token ?? null,
        alpaca_account_id:    alpacaAccountId,
        alpaca_connected_at:  new Date().toISOString(),
      })
      .eq('id', userId);

    if (dbErr) {
      console.error('[alpaca-oauth-callback] DB update failed:', dbErr.message);
      await captureAndFlush(new Error(dbErr.message), { function_name: 'alpaca-oauth-callback' });
      return Response.redirect(`${APP_URL}?alpaca_error=db_error`, 302);
    }

    return Response.redirect(`${APP_URL}?alpaca_connected=true`, 302);
  } catch (err) {
    console.error('[alpaca-oauth-callback] unhandled error:', err);
    await captureAndFlush(err, { function_name: 'alpaca-oauth-callback' });
    return Response.redirect(`${APP_URL}?alpaca_error=unexpected_error`, 302);
  }
});
