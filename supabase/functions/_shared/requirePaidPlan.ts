// Server-side enforcement of "brokerage / investing is paid-Pro only".
//
// Before this helper, alpaca-invest, alpaca-oauth-start and alpaca-portfolio
// did NO server-side plan check at all — the Pro paywall on investing lived
// entirely in React state (src/hooks/usePlan.js + the `(!isPro || isTrial)`
// guards in Markets.jsx / App.jsx). Any valid JWT could call the edge
// functions directly and bypass it. See PENETRATION_TEST_PLAN.md 6.4 and
// SECURITY_THREAT_MODEL.md E4.
//
// Entitlement mirrors usePlan.js exactly: invest is allowed only for a *paid*
// Pro — `profiles.plan === 'pro'` AND NOT inside an active 7-day trial window
// (`trial_ends_at` null or already in the past). That is the same
// `isPaidPro && !hasActiveTrial` condition the client's invest buttons use
// (during the trial the client shows an upgrade prompt, not a Buy button).
//
// Fails CLOSED: unlike enforceRateLimit (a cost guard that fails open), this
// gates a money-moving feature — if the plan can't be read, deny.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Supa = ReturnType<typeof createClient>;

export async function requirePaidPlan(
  supabase: Supa,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan, trial_ends_at')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    console.error('requirePaidPlan: could not read profile plan:', error?.message);
    return new Response(
      JSON.stringify({ error: 'plan_check_failed', message: 'Could not verify your plan. Please try again.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const isPaidPro = profile.plan === 'pro';
  const trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const hasActiveTrial = trialEnd !== null && trialEnd.getTime() > Date.now();

  if (!isPaidPro || hasActiveTrial) {
    return new Response(
      JSON.stringify({ error: 'upgrade_required', message: 'Upgrade to Pro to invest' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return null;
}
