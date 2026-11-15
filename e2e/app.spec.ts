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

test('reveals only controls for the selected storage option', async ({
  app,
}) => {
  const window = await app.firstWindow();
  const storage = window.getByRole('combobox', { name: 'Save to' });
  await expect(storage).toHaveValue('');
  await expect(storage.locator('option:not([disabled])')).toHaveText([
    'Local',
    'Cloud',
    'S3',
  ]);
  await expect(
    window.getByRole('button', {
      name: /Select .*folder|Connect|Add Dropbox|Upload a video/,
    }),
  ).toHaveCount(0);
  await expect(
    window.getByRole('button', { name: 'Submit', exact: true }),
  ).toBeDisabled();
  await storage.selectOption('local');
  await expect(
    window.getByRole('button', { name: 'Select folder', exact: true }),
  ).toBeVisible();
  await storage.selectOption('cloud');
  await expect(
    window.getByRole('button', { name: 'Select folder', exact: true }),
  ).toHaveCount(0);
  await expect(
    window.getByRole('group', { name: 'Cloud provider' }).getByRole('radio'),
  ).toHaveCount(3);
  await expect(
    window.getByRole('button', {
      name: 'Select Google Drive folder',
      exact: true,
    }),
  ).toBeVisible();
  await storage.selectOption('s3');
  await expect(
    window.getByRole('group', { name: 'Cloud provider' }),
  ).toHaveCount(0);
  await expect(
    window.getByRole('button', {
      name: 'Select Google Drive folder',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    window.getByRole('button', {
      name: 'Upload a video from computer',
      exact: true,
    }),
  ).toBeVisible();
});
