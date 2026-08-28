import { Capacitor } from '@capacitor/core';

// True in the native iOS/Android shells only, false on the plain web build —
// even though both share this exact JS bundle. Capacitor.isNativePlatform()
// is the only reliable check: @capacitor/core sets window.Capacitor
// unconditionally at import time on every platform (it's how the JS runtime
// bootstraps itself), so `window.Capacitor` being truthy does NOT mean
// native — that mistake let a Capacitor.App.addListener() call run
// unguarded on web in production (Sentry: '"App" plugin is not implemented
// on web', 2026-08-27) because the check used was `!window.Capacitor`.
export const IS_NATIVE = Capacitor.isNativePlatform();

// iOS App Store build only — used to hide purchase UI (price, "Upgrade" CTAs,
// links) per Guideline 3.1.3 anti-steering. Never gates feature access itself
// — that's usePlan.js reading profiles.plan, independent of platform, so a
// user who bought Pro on the web still gets full access on iOS.
export const IS_IOS_NATIVE = IS_NATIVE && Capacitor.getPlatform() === 'ios';
