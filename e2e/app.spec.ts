import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';

let app: ElectronApplication;

test.beforeEach(async () => {
  // Launches the Vite build output in `.vite/build` (see package.json `main`).
  app = await electron.launch({ args: ['.'] });
});

test.afterEach(async () => {
  await app.close();
});

test('opens the main window', async () => {
  const window = await app.firstWindow();
  await expect(window).toHaveTitle('Yoink');
  await expect(window.getByRole('heading', { level: 1 })).toContainText(
    'Hello World!',
  );
});

test('shows runtime versions from the preload bridge', async () => {
  const window = await app.firstWindow();
  const electronVersion = await app.evaluate(() => process.versions.electron);
  await expect(window.locator('#versions')).toContainText(
    `Electron ${electronVersion}`,
  );
});
