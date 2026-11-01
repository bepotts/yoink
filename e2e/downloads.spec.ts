// Verifies link entry, required input validation, and download submission feedback.

import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/shared/ipc';

test('submits the link and folder and shows download completion', async ({
  app,
}) => {
  await app.evaluate(({ dialog, ipcMain }, channel) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ['/tmp/videos'],
    });
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, request) => {
      if (
        request.link !== 'https://example.com/video' ||
        request.folder !== '/tmp/videos'
      ) {
        throw new Error('Incorrect download request');
      }
      return new Promise((resolve) => {
        Object.assign(globalThis, {
          finishDownload: () => resolve({ success: true }),
        });
      });
    });
  }, IPC_CHANNELS.downloadVideo);
  const window = await app.firstWindow();
  await window
    .getByRole('textbox', { name: 'Link' })
    .fill('https://example.com/video');
  await window.getByRole('button', { name: 'Select folder' }).click();
  await expect(window.locator('#selected-folder')).toHaveText('/tmp/videos');
  const submit = window.getByRole('button', { name: 'Submit', exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(window.locator('#download-status')).toHaveText('Downloading…');
  await app.evaluate(() => {
    (
      globalThis as typeof globalThis & { finishDownload: () => void }
    ).finishDownload();
  });
  await expect(window.locator('#download-status')).toHaveText(
    'Download complete. Video saved to the selected folder.',
  );
  await expect(submit).toBeEnabled();
});

test('accepts a link', async ({ app }) => {
  const window = await app.firstWindow();
  const link = window.getByRole('textbox', { name: 'Link' });
  await link.fill('https://example.com/video');
  await expect(link).toHaveValue('https://example.com/video');
});

test('requires a link and selected folder before submitting', async ({
  app,
}) => {
  const window = await app.firstWindow();
  await window.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(window.locator('#download-status')).toHaveText(
    'Please enter a video link.',
  );
  await window
    .getByRole('textbox', { name: 'Link' })
    .fill('https://example.com/video');
  await window.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(window.locator('#download-status')).toHaveText(
    'Please select a folder.',
  );
});
