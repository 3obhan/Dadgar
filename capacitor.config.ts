import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.sobhan_ganji.mrjudge',
  appName: 'آقای قاضی',
  webDir: 'dist',
  server: {
    url: 'http://mrjudge.sobhan-ganji.workers.dev',
    cleartext: true,
    allowNavigation: [
      'mrjudge.sobhan-ganji.workers.dev',
      '*.stripe.com',
      '*.paypal.com',
    ],
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
