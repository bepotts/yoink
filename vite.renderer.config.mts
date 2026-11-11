// Configures the React renderer build and development support in Vite.

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Enables renderer monitoring only when the main build has an ingestion DSN.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'SENTRY_DSN');
  return {
    define: { SENTRY_ENABLED: JSON.stringify(Boolean(env.SENTRY_DSN)) },
    plugins: [react()],
    build: { sourcemap: true },
  };
});
