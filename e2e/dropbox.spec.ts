// Verifies adding a Dropbox account and selecting a Dropbox folder or root as the video destination.

import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/ipc/channels';

for (const target of ['/videos', '']) {
  test(`adds a Dropbox account and uploads videos to ${target || 'the Dropbox root'}`, async ({
    app,
  }) => {
    await app.evaluate(
      ({ ipcMain }, { channels, destination }) => {
        ipcMain.removeHandler(channels.dropboxStatus);
        ipcMain.handle(channels.dropboxStatus, () => ({ connected: false }));
        ipcMain.removeHandler(channels.connectDropbox);
        ipcMain.handle(channels.connectDropbox, () => ({ connected: true }));
        ipcMain.removeHandler(channels.listDropboxFolders);
        ipcMain.handle(channels.listDropboxFolders, (_event, folderPath) => ({
          folder: { path: folderPath, name: folderPath ? 'Videos' : 'Dropbox' },
          folders: folderPath ? [] : [{ path: '/videos', name: 'Videos' }],
        }));
        ipcMain.removeHandler(channels.downloadVideo);
        ipcMain.handle(channels.downloadVideo, (_event, request) => {
          if (
            request.dropboxFolderPath !== destination ||
            request.folder !== '' ||
            request.driveFolderId !== undefined ||
            request.oneDriveFolderId !== undefined
          )
            throw new Error('Dropbox must replace other destinations');
          return { success: true };
        });
        ipcMain.removeHandler(channels.disconnectDropbox);
        let attempts = 0;
        ipcMain.handle(channels.disconnectDropbox, () => {
          attempts++;
          return attempts === 1
            ? {
                connected: true,
                error: 'Dropbox is unavailable. Retry disconnect.',
              }
            : { connected: false };
        });
      },
      { channels: IPC_CHANNELS, destination: target },
    );
    const window = await app.firstWindow();
    await window.reload();
    await window.getByLabel('Save to').selectOption('dropbox');
    const select = window.getByRole('button', {
      name: 'Select Dropbox folder',
      exact: true,
    });
    await expect(select).toBeDisabled();
    await window
      .getByRole('button', { name: 'Add Dropbox account', exact: true })
      .click();
    await expect(select).toBeEnabled();
    await select.click();
    const picker = window.getByRole('dialog', {
      name: 'Select Dropbox folder',
    });
    await expect(
      picker.getByRole('button', { name: 'Back', exact: true }),
    ).toBeDisabled();
    if (target)
      await picker.getByRole('button', { name: 'Videos', exact: true }).click();
    await picker
      .getByRole('button', { name: 'Use this folder', exact: true })
      .click();
    const name = target ? 'Dropbox: Videos' : 'Dropbox: Dropbox';
    await expect(window.getByText(name, { exact: true })).toBeVisible();
    await window
      .getByRole('textbox', { name: 'Link' })
      .fill('https://example.com/video');
    await window.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(window.locator('#download-status')).toHaveText(
      'Upload complete. Video saved to Dropbox.',
    );
    await expect(
      window.getByRole('button', { name: 'Open Dropbox folder', exact: true }),
    ).toBeVisible();
    await select.click();
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(window.getByText(name, { exact: true })).toBeVisible();
    const disconnect = window.getByRole('button', {
      name: 'Disconnect Dropbox',
      exact: true,
    });
    await disconnect.click();
    await expect(disconnect).toBeEnabled();
    await expect(window.getByText(name, { exact: true })).toBeVisible();
    await disconnect.click();
    await expect(
      window.getByRole('button', { name: 'Add Dropbox account', exact: true }),
    ).toBeVisible();
    await expect(
      window.getByText('No Dropbox folder selected', { exact: true }),
    ).toBeVisible();
    await window.getByLabel('Save to').selectOption('drive');
    await expect(
      window.getByRole('button', {
        name: 'Select Google Drive folder',
        exact: true,
      }),
    ).toBeVisible();
    await window.getByLabel('Save to').selectOption('onedrive');
    await expect(
      window.getByRole('button', {
        name: 'Select OneDrive folder',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      window.getByRole('button', { name: 'Upload files…' }),
    ).toHaveCount(0);
  });
}
