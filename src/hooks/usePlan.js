export function usePlan(profile) {
  const isPro = profile?.plan === 'pro';
  return { isPro };
}
