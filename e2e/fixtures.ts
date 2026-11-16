// Provides an isolated Electron app instance and cleanup for each end-to-end test.

import { mkdir } from 'node:fs/promises';
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
} from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend<{ app: ElectronApplication }>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use, testInfo) => {
    // Prevent saved destinations and Google credentials from leaking into tests.
    const userData = testInfo.outputPath('user-data');
    await mkdir(userData, {
      recursive: true,
    });
    // Launch the Vite build output in `.vite/build` (see package.json `main`).
    // act containers run as root; Chromium requires disabling its sandbox there.
    const args = ['.', `--user-data-dir=${userData}`];
    if (process.platform === 'linux' && process.getuid?.() === 0) {
      args.push('--no-sandbox');
    }
    const app = await electron.launch({ args });
    try {
      // Window creation follows IPC registration; wait before tests replace handlers.
      await app.firstWindow();
      await use(app);
    } finally {
      await app.close();
    }
  },
});
