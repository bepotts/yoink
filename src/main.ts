// Manages Electron windows and initializes IPC handlers.

import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { setupMonitoring } from './monitoring/main';
import { registerIpcHandlers } from './ipc/handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

app.setName('Yoink');
setupMonitoring();
setupLogging();

const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(app.getAppPath(), 'assets/icon.png');

// Creates the main window and records loading and renderer failures.
const createWindow = () => {
  log.info('Creating main window');
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  registerWindowErrorHandlers(mainWindow);

  // Load the development server or packaged application.
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
  log.info('Application ready');
  app.dock?.setIcon(iconPath);
  registerIpcHandlers();

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

/**  Below this point are function definitions */

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Configures log transports, error capture, and application lifecycle diagnostics.
function setupLogging(): void {
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.console.level = app.isPackaged ? 'warn' : 'debug';
  log.initialize();
  log.errorHandler.startCatching({ showDialog: false });
  log.info('Application starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  });

  app.on('before-quit', () => log.info('Application quitting'));
  app.on('child-process-gone', (_event, details) => {
    log.error(
      'Child process exited',
      details.type,
      details.reason,
      details.exitCode,
    );
  });
}

// Registers diagnostics for renderer crashes, preload failures, loading errors, and hangs.
function registerWindowErrorHandlers(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer exited', details.reason, details.exitCode);
  });
  mainWindow.webContents.on('preload-error', (_event, _preloadPath, error) => {
    log.error('Preload failed', error);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    log.error('Window failed to load', code, description);
  });
  mainWindow.on('unresponsive', () => log.warn('Main window is unresponsive'));
}
