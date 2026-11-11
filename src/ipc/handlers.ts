// Registers the main-process IPC handlers.

import log from 'electron-log/main';
import {
  googleAccountStatus,
  connectGoogleAccount,
  disconnectGoogleAccount,
  selectDriveFolder,
} from '../cloud-storage/google/account';
import {
  requireDriveFolder,
  uploadDriveFile,
  validateDriveFolderId,
} from '../cloud-storage/google/drive';
import {
  oneDriveStatus,
  connectOneDrive,
  disconnectOneDrive,
} from '../cloud-storage/onedrive/account';
import {
  listOneDriveFolders,
  oneDriveFolderUrl,
} from '../cloud-storage/onedrive/drive';
import {
  dropboxStatus,
  connectDropbox,
  disconnectDropbox,
} from '../cloud-storage/dropbox/account';
import {
  listDropboxFolders,
  dropboxFolderUrl,
} from '../cloud-storage/dropbox/drive';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from './channels';
import { downloadVideo } from './download';
import { notifyDownloadComplete } from './download-notification';
import type { DownloadRequest } from './download-types';

// Registers native download and Google account operations for the renderer.
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.dropboxStatus, dropboxStatus);
  ipcMain.handle(IPC_CHANNELS.connectDropbox, connectDropbox);
  ipcMain.handle(IPC_CHANNELS.disconnectDropbox, disconnectDropbox);
  ipcMain.handle(
    IPC_CHANNELS.listDropboxFolders,
    async (_event, folderPath: string, cursor?: string) => {
      try {
        return await listDropboxFolders(folderPath, cursor);
      } catch {
        log.warn('Could not load Dropbox folders');
        throw new Error(
          'Could not load Dropbox folders. Reconnect Dropbox and try again.',
        );
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.openDropboxFolder,
    async (_event, folderPath: string) => {
      try {
        await shell.openExternal(dropboxFolderUrl(folderPath));
        return '';
      } catch {
        log.warn('Could not open the Dropbox folder');
        return 'Could not open the Dropbox folder.';
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.oneDriveStatus, oneDriveStatus);
  ipcMain.handle(IPC_CHANNELS.connectOneDrive, connectOneDrive);
  ipcMain.handle(IPC_CHANNELS.disconnectOneDrive, disconnectOneDrive);
  ipcMain.handle(
    IPC_CHANNELS.listOneDriveFolders,
    async (_event, id: string, nextPage?: string) => {
      try {
        return await listOneDriveFolders(id, nextPage);
      } catch {
        log.warn('Could not load OneDrive folders');
        throw new Error(
          'Could not load OneDrive folders. Reconnect Microsoft and try again.',
        );
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.openOneDriveFolder,
    async (_event, id: string) => {
      try {
        // Resolve Microsoft's personal or work-account browser link in the main process.
        await shell.openExternal(await oneDriveFolderUrl(id));
        return '';
      } catch {
        log.warn('Could not open the OneDrive folder');
        return 'Could not open the OneDrive folder.';
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.selectDriveFolder, selectDriveFolder);
  ipcMain.handle(IPC_CHANNELS.openDriveFolder, async (_event, id: string) => {
    try {
      validateDriveFolderId(id);
      await shell.openExternal(`https://drive.google.com/drive/folders/${id}`);
      return '';
    } catch {
      log.warn('Could not open the Google Drive folder');
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
      log.warn('Could not open the download folder');
      return 'Could not open the download folder. It may have been moved or deleted.';
    }
  });
  const downloads = new Set<number>();
  ipcMain.handle(IPC_CHANNELS.uploadFiles, async (event, folderId: string) => {
    const id = event.sender.id;
    if (downloads.has(id))
      return {
        success: false,
        error: 'A transfer is already in progress.',
      };
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return null;
    downloads.add(id);
    let uploaded = 0;
    try {
      await requireDriveFolder(folderId);
      const selected = await dialog.showOpenDialog(owner, {
        title: 'Select files to upload to Google Drive',
        properties: ['openFile', 'multiSelections'],
      });
      if (selected.canceled) return null;
      log.info('Google Drive upload started', {
        count: selected.filePaths.length,
      });
      for (const file of selected.filePaths) {
        await uploadDriveFile(file, folderId);
        uploaded++;
      }
      log.info('Google Drive upload completed', { uploaded });
      return { success: true };
    } catch {
      log.error('Google Drive upload failed', { uploaded });
      return {
        success: false,
        error: `Upload failed after ${uploaded} file(s). Check Google access, folder permissions, and storage space. Your original files remain on your computer.`,
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
            request.dropboxFolderPath !== undefined
              ? 'Dropbox'
              : request.driveFolderId
                ? 'Google Drive'
                : request.oneDriveFolderId
                  ? 'OneDrive'
                  : request.folder,
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
