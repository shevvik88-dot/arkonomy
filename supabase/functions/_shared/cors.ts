// supabase/functions/_shared/cors.ts
// Shared CORS resolver for edge functions.
//
// Replaces the static `'Access-Control-Allow-Origin': Deno.env.get('APP_URL')`
// constant that was copy-pasted across ~20 functions — a static prod origin
// breaks non-prod browser callers (Vercel preview deployments get a fresh
// random subdomain hash on every push; a future staging origin is the same
// problem).
//
// allow-list = prod origin (APP_URL) + Vercel preview subdomains, plus any
// caller-supplied `extraOrigins`. A matching origin is echoed back; anything
// else falls back to the prod origin, so the response NEVER reflects an
// arbitrary origin. `prodOnly: true` drops the preview regex entirely — for
// endpoints where a preview build has no legitimate reason to call (there's
// nothing to test against prod data), e.g. account deletion.
//
// Always set:
//   Vary: Origin       — so an intermediary cache can't key one origin's CORS
//                        headers against a different origin's request
//                        (security-auditor finding, 2026-08-23).
//   Cache-Control: no-store — every caller returns per-user authenticated data;
//                        matches the hardening alpaca-portfolio already sets
//                        inline (security-auditor, 2026-08-24).
//
// The single implementation. Every edge function's CORS goes through here
// (the last inline copies were collapsed onto this module 2026-09-07); the
// only other holder of the prod-origin literal is exported below.

// Also the GoTrue `redirect_to` target in auth-signup — exported so there is
// one source of truth for "what is this app's prod origin".
export const PROD_ORIGIN = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';

const VERCEL_PREVIEW_RE =
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/;

const BASE_ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';

export interface CorsOptions {
  // Drop the Vercel preview regex — prod origin only. For endpoints a preview
  // build should never call (nothing to test against prod data), e.g.
  // delete-account.
  prodOnly?: boolean;
  // Extra allowed origins, on top of the prod origin + Vercel preview regex.
  // e.g. auth-login passes `[/^http:\/\/localhost:\d+$/]` for local dev — see
  // its own comment for the 2026-08-28 incident that needs it. Deliberately
  // NOT a default: the Plaid/money functions stay prod + preview only.
  // RegExp entries must NOT carry the `g`/`y` flag (stateful `lastIndex`);
  // resolveCorsHeaders strips flags defensively anyway.
  extraOrigins?: (string | RegExp)[];
  // Extra request headers to allow, appended to the base list
  // (e.g. 'x-firebase-appcheck').
  extraAllowHeaders?: string;
  // Value for Access-Control-Allow-Methods. Every current function is
  // POST-only, so that is the default.
  allowMethods?: string;
}

export function resolveCorsHeaders(
  req: Request,
  opts: CorsOptions = {},
): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowList: (string | RegExp)[] = opts.prodOnly
    ? [PROD_ORIGIN]
    : [PROD_ORIGIN, VERCEL_PREVIEW_RE, ...(opts.extraOrigins ?? [])];
  const allowedOrigin = allowList.some(o => {
    if (typeof o === 'string') return o === origin;
    // Strip g/y flags so a caller-supplied regex can't carry stateful
    // lastIndex across requests (module-scoped literals persist it).
    return (o.flags ? new RegExp(o.source, o.flags.replace(/[gy]/g, '')) : o).test(origin);
  })
    ? origin
    : PROD_ORIGIN;

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': opts.extraAllowHeaders
      ? `${BASE_ALLOW_HEADERS}, ${opts.extraAllowHeaders}`
      : BASE_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': opts.allowMethods ?? 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}
