// Registers the main-process IPC handlers.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from './channels';
import { downloadVideo } from './download';
import { notifyDownloadComplete } from './download-notification';
import type { DownloadRequest } from './download-types';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.openFolder, async (_event, folder: string) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
      return 'Please provide a valid folder path.';
    }
    try {
      if (!(await stat(folder)).isDirectory())
        return 'The download folder is no longer available.';
      return await shell.openPath(folder);
    } catch {
      return 'Could not open the download folder. It may have been moved or deleted.';
    }
  });
  const downloads = new Set<number>();
  ipcMain.handle(
    IPC_CHANNELS.downloadVideo,
    async (event, request: DownloadRequest) => {
      if (
        !request ||
        typeof request.link !== 'string' ||
        typeof request.folder !== 'string'
      ) {
        return {
          success: false,
          error: 'Please provide a video link and folder.',
        };
      }
      const id = event.sender.id;
      if (downloads.has(id))
        return { success: false, error: 'A download is already in progress.' };
      downloads.add(id);
      try {
        const result = await downloadVideo(request, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.downloadProgress, progress);
          }
        });
        if (result.success) notifyDownloadComplete(request.folder);
        return result;
      } finally {
        downloads.delete(id);
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.selectFolder, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return null;

    const result = await dialog.showOpenDialog(owner, {
      title: 'Select a folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
