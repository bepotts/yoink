// Provides an isolated Electron app instance and cleanup for each end-to-end test.

import {
  _electron as electron,
  test as base,
  type ElectronApplication,
} from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend<{ app: ElectronApplication }>({
  // Playwright requires destructuring here to discover fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    // Launch the Vite build output in `.vite/build` (see package.json `main`).
    const app = await electron.launch({ args: ['.'] });
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});
