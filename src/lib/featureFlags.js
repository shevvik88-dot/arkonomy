import posthog from 'posthog-js';

// Wraps posthog-js's feature flag reads so call sites never have to guard
// against PostHog not being loaded (VITE_POSTHOG_PROJECT_TOKEN unset, or
// flags not yet fetched from the server) — always returns `fallback`
// instead of throwing or blocking render.

export function isFeatureEnabled(key, fallback = false) {
  try {
    return posthog.isFeatureEnabled(key, { defaultValue: fallback }) ?? fallback;
  } catch {
    return fallback;
  }
}

// For multivariate flags — returns the variant key/string, or `fallback`.
export function getFeatureFlag(key, fallback) {
  try {
    const value = posthog.getFeatureFlag(key);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}
