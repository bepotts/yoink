// Verifies folder selection, cancellation, and recovery from dialog errors.

import { expect, test } from './fixtures';

test('selects a folder through the preload and main process', async ({
  app,
}) => {
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
  await expect(window.locator('#selected-folder')).toHaveText(
    'No folder selected',
  );
  await button.click();
  await expect(button).toBeDisabled();
  await app.evaluate(() => {
    (
      globalThis as typeof globalThis & { finishFolderSelection: () => void }
    ).finishFolderSelection();
  });
  await expect(window.locator('#selected-folder')).toHaveText('/tmp/My Folder');
  await expect(button).toBeEnabled();

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(window.locator('#selected-folder')).toHaveText('/tmp/My Folder');
});

test('canceling the folder picker leaves the initial state intact', async ({
  app,
}) => {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  const window = await app.firstWindow();
  const button = window.getByRole('button', { name: 'Select folder' });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(window.locator('#selected-folder')).toHaveText(
    'No folder selected',
  );
});

test('recovers after a folder picker error', async ({ app }) => {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      throw new Error('Dialog unavailable');
    };
  });
  const window = await app.firstWindow();
  const button = window.getByRole('button', { name: 'Select folder' });
  await button.click();
  await expect(window.locator('#selected-folder')).toHaveText(
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
  await expect(window.locator('#selected-folder')).toHaveText('/tmp/retry');
  await expect(button).toBeEnabled();
});
