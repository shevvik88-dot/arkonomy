// supabase/functions/_shared/sentry.ts
// Shared Sentry Deno SDK setup for edge functions — one init/scrub
// implementation instead of copy-pasting into every function that gets
// Sentry added. Starts with ai-chat + get-insights (both have had real
// production crashes); more functions can call initSentry() as they're
// covered, without duplicating this logic per file.
//
// Known Deno SDK limitation (per Sentry's docs): Deno.serve isn't
// instrumented, so there's no automatic per-request scope separation —
// a warm, reused isolate could carry global-scope state (tags/breadcrumbs)
// across requests. Mitigations here: defaultIntegrations: false (per
// Supabase's official guide — avoids relying on automatic instrumentation
// that assumes per-request isolation) and captureAndFlush() always wraps
// the capture in Sentry.withScope() so per-request tags/context never
// leak onto the shared global scope for the next invocation.
import * as Sentry from "npm:@sentry/deno@^8";

// Extended 2026-08-24 (security-auditor finding on alpaca-portfolio): the
// original list predates the Alpaca-money-path functions and didn't cover
// brokerage field names or credential-shaped keys — no live leak found
// through this list today (every current captureAndFlush call in those
// functions passes only {function_name, stage}), but it's a defense-in-
// depth gap for whatever gets logged through this shared helper next.
const SENSITIVE_KEYS = /^(balance|amount|amounts|description|descriptions|email|token|access_token|refresh_token|notional|qty|cash|buying_power|portfolio_value|market_value|account_number)$/i;
function scrubSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSensitive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[Redacted]" : scrubSensitive(v);
    }
    return out;
  }
  return value;
}

let initialized = false;

export function initSentry(functionName: string) {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: Deno.env.get("ENVIRONMENT") ?? "production",
    defaultIntegrations: false,
    sendDefaultPii: false,
    // deno-lint-ignore no-explicit-any
    beforeSend: (event: any) => scrubSensitive(event),
  });
  Sentry.setTag("function_name", functionName);
  initialized = true;
}

// Always call from a catch block. Wraps the capture in its own scope (see
// note above) and flushes before the function returns — edge functions
// don't keep running after the response is sent, so an un-flushed event
// can be dropped.
export async function captureAndFlush(err: unknown, extra?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    if (extra) scope.setContext("request", scrubSensitive(extra) as Record<string, unknown>);
    Sentry.captureException(err);
  });
  await Sentry.flush(2000);
}

export { Sentry };
