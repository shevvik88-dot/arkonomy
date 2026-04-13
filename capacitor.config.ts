import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arkonomy.app',
  appName: 'Arkonomy',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // @capacitor/app listens for 'appUrlOpen' events triggered by the
    // arkonomy:// URL scheme (registered in ios/App/App/Info.plist).
    // This powers Plaid OAuth redirect handling: after a bank OAuth flow,
    // iOS fires appUrlOpen with the redirect URL, which is passed to
    // usePlaidLink as receivedRedirectUri to complete the handshake.
    // See: src/hooks/usePlaidOAuth.js
    App: {
      // Deep link scheme: arkonomy://
      // Plaid redirect URI (HTTPS, registered in Plaid Dashboard): https://app.arkonomy.com/
    },
  },
};

export default config;
