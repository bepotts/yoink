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
    'Yoink',
  );
});

test('shows runtime versions from the preload bridge', async () => {
  const window = await app.firstWindow();
  const electronVersion = await app.evaluate(() => process.versions.electron);
  await expect(window.locator('#versions')).toContainText(
    `Electron ${electronVersion}`,
  );
});

test('accepts a link', async () => {
  const window = await app.firstWindow();
  const link = window.getByRole('textbox', { name: 'Link' });
  await link.fill('https://example.com/video');
  await expect(link).toHaveValue('https://example.com/video');
});

test('selects a folder through the preload and main process', async () => {
  const window = await app.firstWindow();
  await app.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showOpenDialog = (owner, options) => {
      if (
        !(owner instanceof BrowserWindow) ||
        options?.properties?.join(',') !== 'openDirectory'
      ) {
        throw new Error(
          'Expected a folder dialog attached to the requesting window',
        );
      }
      return new Promise((resolve) => {
        Object.assign(globalThis, {
          finishFolderSelection: () =>
            resolve({ canceled: false, filePaths: ['/tmp/My Folder'] }),
        });
      });
    };
  });

  const button = window.getByRole('button', { name: 'Select folder' });
  await expect(window.getByRole('status')).toHaveText('No folder selected');
  await button.click();
  await expect(button).toBeDisabled();
  await app.evaluate(() => {
    (
      globalThis as typeof globalThis & { finishFolderSelection: () => void }
    ).finishFolderSelection();
  });
  await expect(window.getByRole('status')).toHaveText('/tmp/My Folder');
  await expect(button).toBeEnabled();

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(window.getByRole('status')).toHaveText('/tmp/My Folder');
});

test('canceling the folder picker leaves the initial state intact', async () => {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  const window = await app.firstWindow();
  const button = window.getByRole('button', { name: 'Select folder' });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(window.getByRole('status')).toHaveText('No folder selected');
});

test('recovers after a folder picker error', async () => {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      throw new Error('Dialog unavailable');
    };
  });
  const window = await app.firstWindow();
  const button = window.getByRole('button', { name: 'Select folder' });
  await button.click();
  await expect(window.getByRole('status')).toHaveText(
    'Could not open the folder picker. Please try again.',
  );
  await expect(button).toBeEnabled();

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ['/tmp/retry'],
    });
  });
  await button.click();
  await expect(window.getByRole('status')).toHaveText('/tmp/retry');
  await expect(button).toBeEnabled();
});
