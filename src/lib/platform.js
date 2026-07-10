import { Capacitor } from '@capacitor/core';

// iOS App Store build only — used to hide purchase UI (price, "Upgrade" CTAs,
// links) per Guideline 3.1.3 anti-steering. Never gates feature access itself
// — that's usePlan.js reading profiles.plan, independent of platform, so a
// user who bought Pro on the web still gets full access on iOS.
export const IS_IOS_NATIVE = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
