// Configures the Electron main build with installed-application OAuth identifiers.

import { defineConfig, loadEnv } from 'vite';

// Loads desktop OAuth identifiers and the backend URL into the main-process bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), [
    'YOINK_BACKEND_URL',
    'GOOGLE_',
    'MICROSOFT_',
    'DROPBOX_',
    'SENTRY_DSN',
  ]);
  return {
    // Bundles public app configuration without user tokens or AWS credentials.
    define: {
      YOINK_BACKEND_URL: JSON.stringify(
        env.YOINK_BACKEND_URL || 'http://127.0.0.1:8000',
      ),
      SENTRY_DSN: JSON.stringify(env.SENTRY_DSN ?? ''),
      DROPBOX_APP_KEY: JSON.stringify(env.DROPBOX_APP_KEY ?? ''),
      DROPBOX_REDIRECT_URI: JSON.stringify(
        env.DROPBOX_REDIRECT_URI || 'http://127.0.0.1:53683/dropbox-callback',
      ),
      // Microsoft Entra public desktop application ID.
      MICROSOFT_CLIENT_ID: JSON.stringify(env.MICROSOFT_CLIENT_ID ?? ''),
      // Microsoft registration audience: consumers, organizations, common, or a tenant GUID.
      MICROSOFT_TENANT_ID: JSON.stringify(env.MICROSOFT_TENANT_ID || 'common'),
      // Google Cloud Desktop application client ID.
      GOOGLE_CLIENT_ID: JSON.stringify(env.GOOGLE_CLIENT_ID ?? ''),
      // Installed-app client secret supplied by Google (not a confidential server secret).
      GOOGLE_CLIENT_SECRET: JSON.stringify(env.GOOGLE_CLIENT_SECRET ?? ''),
    },
    // Keep the large Google API library as a production runtime dependency.
    build: {
      sourcemap: true,
      // Avoid bundling every Google API into the main-process output.
      rollupOptions: {
        // Electron Forge packages production node_modules for runtime resolution.
        external: [
          'googleapis',
          '@azure/msal-node',
          'dropbox',
          'electron-log/main',
          '@sentry/electron/main',
        ],
      },
    },
  };
});
