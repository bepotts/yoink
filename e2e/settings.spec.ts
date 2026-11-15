// Verifies cloud disconnection belongs to Settings rather than the upload controls.

import { expect, test } from './fixtures';
import { IPC_CHANNELS } from '../src/ipc/channels';

for (const provider of [
  {
    name: 'Google Drive',
    status: IPC_CHANNELS.googleStatus,
    disconnect: IPC_CHANNELS.disconnectGoogle,
    connect: 'Connect Google Drive',
  },
  {
    name: 'OneDrive',
    status: IPC_CHANNELS.oneDriveStatus,
    disconnect: IPC_CHANNELS.disconnectOneDrive,
    connect: 'Connect OneDrive',
  },
  {
    name: 'Dropbox',
    status: IPC_CHANNELS.dropboxStatus,
    disconnect: IPC_CHANNELS.disconnectDropbox,
    connect: 'Add Dropbox account',
  },
]) {
  test(`disconnects ${provider.name} only through Settings`, async ({
    app,
  }) => {
    await app.evaluate(({ ipcMain }, channels) => {
      ipcMain.removeHandler(channels.status);
      ipcMain.handle(channels.status, () => ({ connected: true }));
      ipcMain.removeHandler(channels.disconnect);
      ipcMain.handle(channels.disconnect, () => ({ connected: false }));
    }, provider);
    const window = await app.firstWindow();
    await window.reload();
    await window.getByLabel('Save to').selectOption('cloud');
    await window
      .getByRole('radio', { name: provider.name, exact: true })
      .check();
    await expect(
      window.getByRole('button', { name: /^Disconnect/ }),
    ).toHaveCount(0);
    await expect(
      window.getByRole('button', { name: provider.connect, exact: true }),
    ).toHaveCount(0);
    const settingsButton = window.getByRole('button', {
      name: 'Settings',
      exact: true,
    });
    await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
    await settingsButton.click();
    await expect(settingsButton).toHaveAttribute('aria-expanded', 'true');
    const settings = window.getByRole('region', {
      name: 'Settings',
      exact: true,
    });
    const disconnect = settings.getByRole('button', {
      name: `Disconnect ${provider.name}`,
      exact: true,
    });
    await disconnect.click();
    await expect(disconnect).toBeDisabled();
    await expect(
      settings.getByText(`${provider.name} disconnected.`, { exact: true }),
    ).toBeVisible();
    await expect(
      window.getByRole('button', { name: provider.connect, exact: true }),
    ).toBeVisible();
    await expect(
      window.getByRole('button', { name: 'Submit', exact: true }),
    ).toBeDisabled();
    await settingsButton.click();
    await expect(settings).toHaveCount(0);
    await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
    await expect(
      window.getByRole('button', { name: /^Disconnect/ }),
    ).toHaveCount(0);
  });
}
