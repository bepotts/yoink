// Registers the main-process IPC handlers.

import {
  googleAccountStatus,
  connectGoogleAccount,
  disconnectGoogleAccount,
  selectDriveFolder,
} from '../google/account';
import {
  requireDriveFolder,
  uploadDriveFile,
  validateDriveFolderId,
} from '../google/drive';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from './channels';
import { downloadVideo } from './download';
import { notifyDownloadComplete } from './download-notification';
import type { DownloadRequest } from './download-types';

// Registers native download and Google account operations for the renderer.
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.selectDriveFolder, selectDriveFolder);
  ipcMain.handle(IPC_CHANNELS.openDriveFolder, async (_event, id: string) => {
    try {
      validateDriveFolderId(id);
      await shell.openExternal(`https://drive.google.com/drive/folders/${id}`);
      return '';
    } catch {
      return 'Could not open the Google Drive folder.';
    }
  });
  ipcMain.handle(IPC_CHANNELS.googleStatus, googleAccountStatus);
  ipcMain.handle(IPC_CHANNELS.connectGoogle, connectGoogleAccount);
  ipcMain.handle(IPC_CHANNELS.disconnectGoogle, disconnectGoogleAccount);
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
  ipcMain.handle(IPC_CHANNELS.uploadFiles, async (event, folderId: string) => {
    const id = event.sender.id;
    if (downloads.has(id))
      return {
        /* Prevent overlapping transfers. */ success: false,
        /* Actionable busy state. */ error:
          'A transfer is already in progress.',
      };
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return null;
    downloads.add(id);
    let uploaded = 0;
    try {
      await requireDriveFolder(folderId);
      const selected = await dialog.showOpenDialog(owner, {
        // Require explicit user selection rather than accepting renderer-supplied paths.
        title: 'Select files to upload to Google Drive',
        // Allow multiple regular files.
        properties: ['openFile', 'multiSelections'],
      });
      if (selected.canceled) return null;
      for (const file of selected.filePaths) {
        await uploadDriveFile(file, folderId);
        uploaded++;
      }
      return { /* Every selected file uploaded. */ success: true };
    } catch {
      return {
        /* Files remain untouched on disk. */ success: false,
        /* Explain partial success to avoid accidental duplicates. */ error: `Upload failed after ${uploaded} file(s). Check Google access, folder permissions, and storage space. Your original files remain on your computer.`,
      };
    } finally {
      downloads.delete(id);
    }
  });
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
        if (result.success)
          notifyDownloadComplete(
            request.driveFolderId ? 'Google Drive' : request.folder,
          );
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
