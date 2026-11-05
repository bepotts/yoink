// Announces completed downloads through the native notification center.

import { Notification } from 'electron';

export function notifyDownloadComplete(folder: string): void {
  // Notification availability must never change the result of a finished download.
  try {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: 'Download complete',
      body: `Your video has been saved to ${folder}.`,
      silent: false,
      ...(process.platform === 'darwin' ? { sound: 'Glass' } : {}),
    });
    notification.on('failed', (_event, error) => {
      console.warn('Could not show download notification:', error);
    });
    notification.show();
  } catch (error) {
    console.warn('Could not show download notification:', error);
  }
}
