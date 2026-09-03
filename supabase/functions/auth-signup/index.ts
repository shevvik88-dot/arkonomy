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

Deno.serve(async (req) => {
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

    const ip =
      req.headers.get("CF-Connecting-IP") ||
      (req.headers.get("X-Forwarded-For") ?? "").split(",")[0].trim() ||
      "unknown";

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
    // the actual origin, not the single shared edge-infra IP that every
    // request would otherwise carry. Only when we actually resolved one —
    // never forward the literal "unknown".
    const upstreamHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    };
    if (ip !== "unknown") upstreamHeaders["X-Forwarded-For"] = ip;

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
