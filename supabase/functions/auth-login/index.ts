import { createClient } from "jsr:@supabase/supabase-js@2";
import { initSentry, captureAndFlush } from "../_shared/sentry.ts";

initSentry("auth-login");

// Preview deployments get a fresh random subdomain hash on every push
// (arkonomy-<hash>-shevvik88-dots-projects.vercel.app) — a single static
// origin can't cover that, so this is an allow-list/pattern match instead.
// Never echoes back an arbitrary origin: only prod or a Vercel preview URL
// under this exact project match; anything else falls back to prod.
const PROD_ORIGIN = Deno.env.get("APP_URL") ?? "https://app.arkonomy.com";
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/,
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
    const { email, password } = await req.json();
    if (!email || !password) return json({ error: "Email and password required" }, 400);

    const ip =
      req.headers.get("CF-Connecting-IP") ||
      (req.headers.get("X-Forwarded-For") ?? "").split(",")[0].trim() ||
      "unknown";
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
