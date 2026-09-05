import { createClient } from "jsr:@supabase/supabase-js@2";
import { initSentry, captureAndFlush } from "../_shared/sentry.ts";

initSentry("auth-login");

// Preview deployments get a fresh random subdomain hash on every push
// (arkonomy-<hash>-shevvik88-dots-projects.vercel.app) — a single static
// origin can't cover that, so this is an allow-list/pattern match instead.
// Never echoes back an arbitrary origin: only prod, a Vercel preview URL
// under this exact project match, or a local Vite dev server; anything
// else falls back to prod. localhost is safe to allow unconditionally
// (not gated behind an env flag) — the browser only ever sends
// `Origin: http://localhost:<port>` for a request that genuinely
// originated from that machine's own local dev server; a remote attacker
// cannot spoof it into a victim's browser. Added 2026-08-28 — local
// dev login against this function was previously unreachable (CORS
// `Failed to fetch`, found while trying to screenshot a Dashboard change
// against localhost:5173).
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
    // req.json() throws a SyntaxError on a malformed body — caught here
    // specifically so it returns a clean 400 instead of falling through to
    // the general catch below, which would report it to Sentry as a real
    // server error (PENETRATION_TEST_PLAN.md 3.6 — same fix as
    // alpaca-invest's 3.5). This endpoint has no auth check at all (it IS
    // the login endpoint), making it the most trivially reachable of the
    // functions with this gap.
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    const { email, password } = body as { email?: string; password?: string };
    if (!email || !password) return json({ error: "Email and password required" }, 400);

    // Trusted client-IP resolution — `CF-Connecting-IP` is set authoritatively
    // by Cloudflare (fronts *.supabase.co) and cannot be spoofed by the
    // client; it is always present for real production traffic and takes
    // priority (PENETRATION_TEST_PLAN.md 1.1, and re-verified live 2026-09-03
    // against auth-signup: present on every real request, a forged one is
    // WAF-rejected with 403 before origin). The old code fell back to the
    // fully client-controlled `X-Forwarded-For` (leftmost, client-prependable),
    // which — if that branch were ever reached — would let an attacker rotate
    // the header for a fresh 5-attempt lockout budget per forged IP, or
    // DoS-lock a victim's email from a single real IP by forging many.
    // Fallback is now the runtime peer address (`info.remoteAddr` — a socket
    // property, not a header; on Supabase Edge Runtime it's an internal
    // address, so a conservative shared bucket), then a shared "unknown"
    // bucket (background security review, 2026-09-03).
    const cfIp = req.headers.get("CF-Connecting-IP")?.trim() || "";
    // deno-lint-ignore no-explicit-any
    const peerHost = ((info as any)?.remoteAddr?.hostname ?? "").trim();
    const ip = cfIp || peerHost || "unknown";
    const rateLimitKey = `${email.toLowerCase()}::${ip}`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Check existing lockout before attempting auth
    const { data: lockoutCheck } = await supabase.rpc("check_login_lockout", {
      p_key: rateLimitKey,
    });
    if (lockoutCheck?.locked) {
      return json(
        { error: "Too many failed attempts. Try again later.", lockout_seconds: lockoutCheck.lockout_seconds },
        429,
      );
    }

    // 2. Attempt login
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // 3. Record failure; may trigger lockout
      const { data: failureResult } = await supabase.rpc("record_login_failure", {
        p_key: rateLimitKey,
      });
      const extra = failureResult?.locked ? { lockout_seconds: failureResult.lockout_seconds } : {};
      return json(
        { error: error.message, ...extra },
        failureResult?.locked ? 429 : 401,
      );
    }

    // 4. Success — clear attempts and return session
    await supabase.rpc("clear_login_attempts", { p_key: rateLimitKey });

    return json({
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
      user: data.user,
    });
  } catch (e) {
    console.error("auth-login error:", e);
    await captureAndFlush(e, { function_name: "auth-login" });
    return json({ error: "Internal Server Error" }, 500);
  }
});
