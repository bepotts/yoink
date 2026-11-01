// Verifies the app window opens and displays runtime versions.

import { expect, test } from './fixtures';

test('opens the main window', async ({ app }) => {
  const window = await app.firstWindow();
  await expect(window).toHaveTitle('Yoink');
  await expect(window.getByRole('heading', { level: 1 })).toContainText(
    'Yoink',
  );
});

test('shows runtime versions from the preload bridge', async ({ app }) => {
  const window = await app.firstWindow();
  const electronVersion = await app.evaluate(() => process.versions.electron);
  await expect(window.locator('#versions')).toContainText(
    `Electron ${electronVersion}`,
  );
});
