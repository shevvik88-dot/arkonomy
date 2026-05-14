export function usePlan(profile) {
  const now = new Date();
  const trialEnd = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const hasActiveTrial  = trialEnd !== null && trialEnd > now;
  const hasExpiredTrial = trialEnd !== null && trialEnd <= now;
  // Paid pro: plan === 'pro' with no trial_ends_at (cleared by Stripe webhook)
  const isPaidPro    = profile?.plan === 'pro' && trialEnd === null;
  const isPro        = isPaidPro || hasActiveTrial;
  const isTrial      = hasActiveTrial;
  const trialExpired = hasExpiredTrial && !isPaidPro;
  const trialDaysLeft = hasActiveTrial
    ? Math.ceil((trialEnd - now) / 86_400_000)
    : 0;
  return { isPro, isTrial, trialDaysLeft, trialExpired };
}
