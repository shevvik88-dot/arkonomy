import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arkonomy.app',
  appName: 'Arkonomy',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
