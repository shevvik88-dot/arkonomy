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
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0B1426',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#2F80FF',
      androidScaleType: 'CENTER_INSIDE',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B1426',
      overlaysWebView: false,
    },
  },
};

export default config;
