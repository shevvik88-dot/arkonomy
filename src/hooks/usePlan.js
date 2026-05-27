export function usePlan(profile) {
  const now = new Date();
  const trialEnd = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const hasActiveTrial  = trialEnd !== null && trialEnd > now;
  const hasExpiredTrial = trialEnd !== null && trialEnd <= now;
  // Paid pro: plan === 'pro' — regardless of whether trial_ends_at was cleared
  const isPaidPro    = profile?.plan === 'pro';
  const isPro        = isPaidPro || hasActiveTrial;
  const isTrial      = hasActiveTrial;
  const trialExpired = hasExpiredTrial && !isPaidPro;
  const trialDaysLeft = hasActiveTrial
    ? Math.ceil((trialEnd - now) / 86_400_000)
    : 0;
  return { isPro, isTrial, trialDaysLeft, trialExpired };
}
