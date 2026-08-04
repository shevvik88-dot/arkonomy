import { useEffect, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import { IS_IOS_NATIVE } from "./platform";

// Native bridge to StorefrontPlugin.swift (StoreKit 2 Storefront.current).
// Country codes here are ISO 3166-1 alpha-3 (StoreKit's format, e.g. "USA"),
// not the alpha-2 codes used elsewhere in the app.
const StorefrontPlugin = registerPlugin("Storefront");

let cached = null;

// Resolved once per app session and cached — the storefront doesn't change
// mid-session, and the native call only needs to fire once regardless of how
// many components ask. Defaults to false (safe/hidden) on non-iOS, while
// resolving, and on any native-call failure — matches the existing
// IS_IOS_NATIVE-only suppression's fail-safe posture.
export async function isUSStorefront() {
  if (!IS_IOS_NATIVE) return false;
  if (cached !== null) return cached;
  try {
    const { countryCode } = await StorefrontPlugin.getCountryCode();
    cached = countryCode === "USA";
  } catch {
    cached = false;
  }
  return cached;
}

export function useUSStorefront() {
  const [isUS, setIsUS] = useState(false);
  useEffect(() => {
    let alive = true;
    isUSStorefront().then(v => { if (alive) setIsUS(v); });
    return () => { alive = false; };
  }, []);
  return isUS;
}
