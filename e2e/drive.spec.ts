// Verifies Drive folder selection and cloud-only video download requests.

import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/ipc/channels';

test('selects a Drive folder as the destination without requiring a local folder', async ({
  app,
}) => {
  await app.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.googleStatus);
    ipcMain.handle(channels.googleStatus, () => ({
      connected: true,
    }));
    ipcMain.removeHandler(channels.selectDriveFolder);
    let selections = 0;
    ipcMain.handle(channels.selectDriveFolder, () => {
      selections++;
      if (selections > 1) return null;
      return {
        id: 'videos-folder',
        name: 'Videos',
      };
    });
    ipcMain.removeHandler(channels.downloadVideo);
    ipcMain.handle(channels.downloadVideo, (_event, request) => {
      if (request.folder !== '' || request.driveFolderId !== 'videos-folder') {
        throw new Error('Drive must replace the local folder');
      }
      return {
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

for (const failureMode of ['error response', 'IPC exception']) {
  test(`retains the Drive destination after disconnect fails with an ${failureMode}`, async ({
    app,
  }) => {
    await app.evaluate(
      ({ ipcMain }, { channels, mode }) => {
        ipcMain.removeHandler(channels.googleStatus);
        ipcMain.handle(channels.googleStatus, () => ({
          connected: true,
        }));
        ipcMain.removeHandler(channels.selectDriveFolder);
        ipcMain.handle(channels.selectDriveFolder, () => ({
          id: 'videos-folder',
          name: 'Videos',
        }));
        ipcMain.removeHandler(channels.disconnectGoogle);
        let attempts = 0;
        ipcMain.handle(channels.disconnectGoogle, () => {
          attempts++;
          if (attempts === 1) {
            if (mode === 'IPC exception')
              throw new Error('synthetic IPC failure');
            return {
              connected: true,
              error:
                'Could not revoke Google access. Check your connection and try again.',
            };
          }
          return {
            connected: false,
          };
        });
      },
      {
        channels: IPC_CHANNELS,
        mode: failureMode,
      },
    );
    const window = await app.firstWindow();
    await window.reload();
    await window.getByLabel('Save to').selectOption('drive');
    await window
      .getByRole('button', { name: 'Select Google Drive folder', exact: true })
      .click();
    const selected = window.getByText('Google Drive: Videos', { exact: true });
    await expect(selected).toBeVisible();
    const disconnect = window.getByRole('button', {
      name: 'Disconnect Google',
      exact: true,
    });
    await disconnect.click();
    await expect(disconnect).toBeEnabled();
    await expect(selected).toBeVisible();
    await expect(
      window.getByRole('button', { name: 'Submit', exact: true }),
    ).toBeEnabled();
    await disconnect.click();
    await expect(
      window.getByRole('button', { name: 'Connect Google Drive', exact: true }),
    ).toBeVisible();
    await expect(
      window.getByText('No Google Drive folder selected', { exact: true }),
    ).toBeVisible();
  });
}
