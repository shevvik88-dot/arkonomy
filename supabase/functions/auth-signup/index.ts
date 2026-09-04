import { initSentry, captureAndFlush } from "../_shared/sentry.ts";
import { enforceIpRateLimit } from "../_shared/ipRateLimit.ts";

initSentry("auth-signup");

// Server-side chokepoint for account creation and confirmation-email resend,
// so both can be IP-rate-limited (PENETRATION_TEST_PLAN.md 6.3 — signup had
// no throttle at all). Mirrors auth-login: the client used to call
// supabase.auth.signUp() / .resend() directly against GoTrue, with nothing
// in between to count requests per IP.
//
// verify_jwt: false — this is pre-auth by definition (no token exists yet).

const PROD_ORIGIN = Deno.env.get("APP_URL") ?? "https://app.arkonomy.com";
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
];

function resolveCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.some(o => typeof o === "string" ? o === origin : o.test(origin))
    ? origin
    : PROD_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req, info) => {
  const corsHeaders = resolveCorsHeaders(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Malformed body → clean 400 (same pattern as auth-login / alpaca-invest,
    // PENETRATION_TEST_PLAN.md 3.5/3.6) rather than a Sentry-reported 500.
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }

    const mode = body.mode === "resend" ? "resend" : "signup";
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = typeof body.full_name === "string" ? body.full_name : "";

    // Trusted client-IP resolution. `CF-Connecting-IP` is set authoritatively
    // by Cloudflare (which fronts *.supabase.co) and cannot be spoofed by the
    // client (PENETRATION_TEST_PLAN.md 1.1).
    //
    // We deliberately do NOT fall back to a client-controlled header:
    // `X-Forwarded-For` is fully attacker-set (a client can prepend a forged
    // leftmost value to the infra-added chain), so keying the rate limit on
    // it would hand an attacker a fresh 10-signup bucket per forged value
    // (background security review, 2026-09-03). If `CF-Connecting-IP` is ever
    // absent, fall back to the runtime peer address (`info.remoteAddr` — a
    // socket property, not a header, never attacker-controlled) and finally a
    // shared "unknown" bucket. Verified live 2026-09-03: `CF-Connecting-IP`
    // is present on every real request to this function (Cloudflare fronts
    // *.supabase.co and injects it; a forged one is rejected at the CF WAF
    // with a 403 before reaching origin), and `info.remoteAddr.hostname` on
    // Supabase Edge Runtime is an internal address (e.g. 0.0.0.0), so the
    // fallback is a single conservative shared bucket that is unreachable in
    // practice — an acceptable failure mode for an abuse guard.
    const cfIp = req.headers.get("CF-Connecting-IP")?.trim() || "";
    // deno-lint-ignore no-explicit-any
    const peerHost = ((info as any)?.remoteAddr?.hostname ?? "").trim();
    const ip = cfIp || peerHost || "unknown";

    // IP rate limit BEFORE anything reaches GoTrue — the counter increments
    // on every call, so even invalid-field spam counts toward the limit.
    // Fail-open (matches _shared/rateLimit.ts): a DB hiccup shouldn't block a
    // legitimate signup.
    const scope = mode === "resend" ? "auth-resend" : "auth-signup";
    const limited = await enforceIpRateLimit(ip, scope, corsHeaders);
    if (limited) return limited;

    if (!email) return json({ error: "Email required" }, 400);
    if (mode === "signup" && !password) return json({ error: "Password required" }, 400);

    const upstreamPath = mode === "resend" ? "resend" : "signup";
    const upstreamBody = mode === "resend"
      ? { type: "signup", email, gotrue_meta_security: {} }
      : {
          email,
          password,
          data: fullName ? { full_name: fullName } : {},
          gotrue_meta_security: {},
        };

    // Forward the real client IP so GoTrue's own limiter and audit log see
    // the actual origin. Forward ONLY the trusted `CF-Connecting-IP` value —
    // never echo a client-supplied `X-Forwarded-For` / peer-fallback into
    // GoTrue's rate limiter, or an attacker rotating that header would
    // bypass GoTrue's throttle too.
    const upstreamHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    };
    if (cfIp) upstreamHeaders["X-Forwarded-For"] = cfIp;

    const upstream = await fetch(
      `${SUPABASE_URL}/auth/v1/${upstreamPath}?redirect_to=${encodeURIComponent(PROD_ORIGIN)}`,
      {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
      },
    );

    const upstreamJson = await upstream.json().catch(() => ({}));
    // Pass GoTrue's response through verbatim (status + body) — the client
    // maps GoTrue's error messages and reads `id` for posthog.identify.
    return json(upstreamJson, upstream.status);
  } catch (e) {
    console.error("auth-signup error:", e);
    await captureAndFlush(e, { function_name: "auth-signup" });
    return json({ error: "Internal Server Error" }, 500);
  }
});
