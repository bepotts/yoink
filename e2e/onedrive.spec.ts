// Verifies OneDrive folder navigation and video uploads as an alternative to Google Drive and local saving.

import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/ipc/channels';

test('browses OneDrive from My files and downloads directly into the selected folder', async ({
  app,
}) => {
  await app.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.oneDriveStatus);
    ipcMain.handle(channels.oneDriveStatus, () => ({
      connected: true,
    }));
    ipcMain.removeHandler(channels.listOneDriveFolders);
    ipcMain.handle(channels.listOneDriveFolders, (_event, id) => ({
      folder: {
        id: id === 'root' ? 'root-id' : id,
        name: id === 'root' ? 'My files' : 'Videos',
      },
      folders:
        id === 'root'
          ? [
              {
                id: 'videos-id',
                name: 'Videos',
              },
            ]
          : [],
    }));
    ipcMain.removeHandler(channels.downloadVideo);
    ipcMain.handle(channels.downloadVideo, (_event, request) => {
      if (
        request.oneDriveFolderId !== 'videos-id' ||
        request.folder !== '' ||
        request.driveFolderId !== undefined
      )
        throw new Error('OneDrive must replace both other destinations');
      return {
        success: true,
      };
    });
  }, IPC_CHANNELS);
  const window = await app.firstWindow();
  await window.reload();
  await window.getByLabel('Save to').selectOption('onedrive');
  await window
    .getByRole('button', { name: 'Select OneDrive folder', exact: true })
    .click();
  const picker = window.getByRole('dialog', { name: 'Select OneDrive folder' });
  await expect(
    picker.getByRole('button', { name: 'Back', exact: true }),
  ).toBeDisabled();
  await picker.getByRole('button', { name: 'Videos', exact: true }).click();
  await expect(
    picker.getByRole('button', { name: 'Back', exact: true }),
  ).toBeEnabled();
  await picker
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click();
  await expect(
    window.getByText('OneDrive: Videos', { exact: true }),
  ).toBeVisible();
  await window
    .getByRole('textbox', { name: 'Link' })
    .fill('https://example.com/video');
  await window.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(window.locator('#download-status')).toHaveText(
    'Upload complete. Video saved to OneDrive.',
  );
  await expect(
    window.getByRole('button', { name: 'Open OneDrive folder', exact: true }),
  ).toBeVisible();
  await window
    .getByRole('button', { name: 'Select OneDrive folder', exact: true })
    .click();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    window.getByText('OneDrive: Videos', { exact: true }),
  ).toBeVisible();
  await window.getByLabel('Save to').selectOption('drive');
  await expect(
    window.getByRole('button', {
      name: 'Select Google Drive folder',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    window.getByRole('button', { name: 'Upload files…' }),
  ).toHaveCount(0);
});
