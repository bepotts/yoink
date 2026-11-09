// Configures the Electron main build with installed-application OAuth identifiers.

import { defineConfig, loadEnv } from 'vite';

// Loads only the desktop OAuth configuration into the main-process bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['GOOGLE_', 'MICROSOFT_']);
  return {
    // Desktop OAuth client identifiers are public app configuration, never user tokens.
    define: {
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
      // Avoid bundling every Google API into the main-process output.
      rollupOptions: {
        // Electron Forge packages production node_modules for runtime resolution.
        external: ['googleapis', '@azure/msal-node'],
      },
    },
  };
});
