// Verifies Drive folder selection and cloud-only video download requests.

import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/ipc/channels';

test('selects a Drive folder as the destination without requiring a local folder', async ({
  app,
}) => {
  await app.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.googleStatus);
    ipcMain.handle(channels.googleStatus, () => ({
      // Fake a connected upload-capable account without live Google access.
      connected: true,
    }));
    ipcMain.removeHandler(channels.selectDriveFolder);
    let selections = 0;
    ipcMain.handle(channels.selectDriveFolder, () => {
      selections++;
      if (selections > 1) return null;
      return {
        // Simulate the folder returned by the browser-based Google Picker.
        id: 'videos-folder',
        // Verified display name.
        name: 'Videos',
      };
    });
    ipcMain.removeHandler(channels.downloadVideo);
    ipcMain.handle(channels.downloadVideo, (_event, request) => {
      if (request.folder !== '' || request.driveFolderId !== 'videos-folder') {
        throw new Error('Drive must replace the local folder');
      }
      return {
        // Simulate successful transfer after validating the destination.
        success: true,
      };
    });
  }, IPC_CHANNELS);
  const window = await app.firstWindow();
  await window.reload();
  await window.getByLabel('Save to').selectOption('drive');
  await window
    .getByRole('button', { name: 'Select Google Drive folder', exact: true })
    .click();
  await expect(window.getByRole('dialog')).toHaveCount(0);
  await expect(
    window.getByText('Google Drive: Videos', { exact: true }),
  ).toBeVisible();
  await expect(
    window.getByRole('button', { name: 'Select folder', exact: true }),
  ).toHaveCount(0);
  await window
    .getByRole('textbox', { name: 'Link' })
    .fill('https://example.com/video');
  await window.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(window.locator('#download-status')).toHaveText(
    'Upload complete. Video saved to Google Drive.',
  );
  await expect(
    window.getByRole('button', { name: 'Open Google Drive folder' }),
  ).toBeVisible();
  await window
    .getByRole('button', { name: 'Select Google Drive folder', exact: true })
    .click();
  await expect(
    window.getByText('Google Drive: Videos', { exact: true }),
  ).toBeVisible();
});
