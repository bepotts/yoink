// Verifies folder selection, cancellation, and recovery from dialog errors.

import { expect, test } from './fixtures';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('saved folder survives an application restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'yoink-saved-folder-'));
  const args = ['.', `--user-data-dir=${userData}`];
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    args.push('--no-sandbox');
  }
  let app = await electron.launch({ args });
  try {
    let window = await app.firstWindow();
    const saveButton = window.getByRole('button', { name: 'Save folder' });
    await expect(saveButton).toBeDisabled();
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: ['/tmp/My Saved Folder'],
      });
    });
    await window.getByRole('button', { name: 'Select folder' }).click();
    await saveButton.click();
    await expect(
      window.getByText('Folder saved for future launches.'),
    ).toBeVisible();
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: ['/tmp/Unsaved Folder'],
      });
    });
    await window.getByRole('button', { name: 'Select folder' }).click();
    await expect(window.locator('#selected-folder')).toHaveText(
      '/tmp/Unsaved Folder',
    );
    await app.close();
    app = await electron.launch({ args });
    window = await app.firstWindow();
    await expect(window.locator('#selected-folder')).toHaveText(
      '/tmp/My Saved Folder',
    );
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

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
