// Verifies link entry, required input validation, and download submission feedback.

import { mkdir } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/shared/ipc';

test('submits the link and folder and shows download completion', async ({
  app,
}, testInfo) => {
  const downloadFolder = testInfo.outputPath('downloads');
  const anotherFolder = testInfo.outputPath('another-folder');
  await mkdir(downloadFolder, { recursive: true });
  await mkdir(anotherFolder, { recursive: true });

  await app.evaluate(
    ({ dialog, ipcMain }, { channel, downloadFolder: folder }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, request) => {
        if (
          request.link !== 'https://example.com/video' ||
          request.folder !== folder
        ) {
          throw new Error('Incorrect download request');
        }
        return new Promise((resolve) => {
          Object.assign(globalThis, {
            finishDownload: () => resolve({ success: true }),
          });
        });
      });
    },
    { channel: IPC_CHANNELS.downloadVideo, downloadFolder },
  );
  const window = await app.firstWindow();
  const openFolder = window.getByRole('button', {
    name: 'Open folder',
    exact: true,
  });
  await expect(openFolder).toHaveCount(0);
  await window
    .getByRole('textbox', { name: 'Link' })
    .fill('https://example.com/video');
  await window.getByRole('button', { name: 'Select folder' }).click();
  await expect(window.locator('#selected-folder')).toHaveText(downloadFolder);
  const submit = window.getByRole('button', { name: 'Submit', exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(window.locator('#download-status')).toHaveText('Downloading…');
  const progressBar = window.getByRole('progressbar', {
    name: 'Download progress',
  });
  await expect(progressBar).toBeVisible();
  await expect(progressBar).not.toHaveAttribute('value');
  await app.evaluate(({ BrowserWindow }, channel) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, {
      phase: 'downloading',
      percent: 42,
    });
  }, IPC_CHANNELS.downloadProgress);
  await expect(progressBar).toHaveAttribute('value', '42');
  await expect(window.getByText('42% of current stream')).toBeVisible();
  await app.evaluate(({ BrowserWindow }, channel) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, {
      phase: 'processing',
      percent: null,
    });
  }, IPC_CHANNELS.downloadProgress);
  await expect(window.getByText('Processing video…')).toBeVisible();
  await expect(progressBar).not.toHaveAttribute('value');
  await app.evaluate(() => {
    (
      globalThis as typeof globalThis & { finishDownload: () => void }
    ).finishDownload();
  });
  await expect(window.locator('#download-status')).toHaveText(
    'Download complete. Video saved to the selected folder.',
  );
  await expect(submit).toBeEnabled();
  await expect(progressBar).toHaveCount(0);
  await expect(openFolder).toBeVisible();
  await app.evaluate(({ shell, dialog }, selectedFolder) => {
    shell.openPath = async (folder) => {
      Object.assign(globalThis, { openedFolder: folder });
      return '';
    };
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedFolder],
    });
  }, anotherFolder);
  await window.getByRole('button', { name: 'Select folder' }).click();
  await expect(window.locator('#selected-folder')).toHaveText(anotherFolder);
  await openFolder.click();
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as typeof globalThis & { openedFolder?: string })
            .openedFolder,
      ),
    )
    .toBe(downloadFolder);
  await app.evaluate(({ shell }) => {
    shell.openPath = async () => 'Could not launch the file manager.';
  });
  await openFolder.click();
  await expect(window.getByRole('alert')).toHaveText(
    'Could not launch the file manager.',
  );
  await expect(openFolder).toBeEnabled();
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
