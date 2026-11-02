// Manages Electron windows and handles folder selection and download IPC requests.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC_CHANNELS } from './shared/ipc';
import { downloadVideo } from './download';
import type { DownloadRequest } from './shared/download';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // Open the DevTools during development only.
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
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
        return await downloadVideo(request, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.downloadProgress, progress);
          }
        });
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

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
