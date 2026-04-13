// src/hooks/usePlaidOAuth.js
//
// Handles Plaid Link OAuth redirect in Capacitor iOS.
//
// Plaid OAuth flow:
//   1. getLinkToken sends redirect_uri = https://app.arkonomy.com/ to backend
//   2. Plaid opens the bank's OAuth page in Safari (not the WebView)
//   3. Bank redirects back to https://app.arkonomy.com/?oauth_state_id=xxx
//   4. Universal Links or the arkonomy:// deep link opens the native app
//   5. @capacitor/app fires 'appUrlOpen' with the full URL
//   6. This hook captures it and returns receivedRedirectUri
//   7. PlaidLinkButton reinitializes usePlaidLink with receivedRedirectUri
//      (and token: null) to complete the OAuth handshake
//
// iOS setup required (one-time, in Xcode):
//   - Add Associated Domains capability: applinks:app.arkonomy.com
//   - Host /.well-known/apple-app-site-association on app.arkonomy.com
//     pointing to your iOS bundle ID (com.arkonomy.app)
//
// Plaid Dashboard setup required:
//   - Register https://app.arkonomy.com/ as an allowed redirect URI

import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';

// The redirect URI registered in the Plaid Dashboard and sent to plaid-link-token.
// Must be an HTTPS URL. Plaid does not accept custom URL schemes (arkonomy://)
// as redirect URIs — that's why we rely on Universal Links to reopen the app.
export const PLAID_REDIRECT_URI = 'https://app.arkonomy.com/';

/**
 * Listens for 'appUrlOpen' events from @capacitor/app and extracts the
 * receivedRedirectUri when the app is re-opened after Plaid OAuth.
 *
 * Returns:
 *   receivedRedirectUri — string | null
 *   clearRedirectUri    — call after usePlaidLink consumes it
 */
export function usePlaidOAuth() {
  // Check if app was cold-launched directly from the OAuth redirect
  // (edge case: app was backgrounded, URI arrives via cold start URL)
  const [receivedRedirectUri, setReceivedRedirectUri] = useState(() => {
    if (typeof window !== 'undefined') {
      const href = window.location.href;
      if (href.includes('oauth_state_id=')) return href;
    }
    return null;
  });

  useEffect(() => {
    // Only wire up listener in native Capacitor environment
    if (typeof window === 'undefined' || !window.Capacitor) return;

    let handle;
    const setup = async () => {
      handle = await App.addListener('appUrlOpen', (event) => {
        const url = event.url ?? '';
        // Accept both the HTTPS Universal Link and arkonomy:// scheme
        if (url.includes('oauth_state_id=')) {
          setReceivedRedirectUri(url);
        }
      });
    };
    setup();

    return () => {
      handle?.remove();
    };
  }, []);

  const clearRedirectUri = () => setReceivedRedirectUri(null);

  return { receivedRedirectUri, clearRedirectUri };
}
