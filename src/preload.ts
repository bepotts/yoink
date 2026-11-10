// Exposes runtime versions and a limited Electron API to the React renderer.

// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import type { Versions } from './shared/versions';
import type {
  DownloadRequest,
  DownloadResult,
  DownloadProgress,
} from './ipc/download-types';

const versions: Versions = {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
};

contextBridge.exposeInMainWorld('versions', versions);
contextBridge.exposeInMainWorld('yoink', {
  dropboxStatus: () => ipcRenderer.invoke(IPC_CHANNELS.dropboxStatus),
  connectDropbox: () => ipcRenderer.invoke(IPC_CHANNELS.connectDropbox),
  disconnectDropbox: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectDropbox),
  listDropboxFolders: (folderPath: string, cursor?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listDropboxFolders, folderPath, cursor),
  openDropboxFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openDropboxFolder, folderPath),
  oneDriveStatus: () => ipcRenderer.invoke(IPC_CHANNELS.oneDriveStatus),
  connectOneDrive: () => ipcRenderer.invoke(IPC_CHANNELS.connectOneDrive),
  disconnectOneDrive: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectOneDrive),
  listOneDriveFolders: (id: string, nextPage?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listOneDriveFolders, id, nextPage),
  openOneDriveFolder: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openOneDriveFolder, id),
  selectDriveFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectDriveFolder),
  openDriveFolder: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openDriveFolder, id),
  uploadFiles: (folderId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.uploadFiles, folderId),
  googleStatus: () => ipcRenderer.invoke(IPC_CHANNELS.googleStatus),
  connectGoogle: () => ipcRenderer.invoke(IPC_CHANNELS.connectGoogle),
  disconnectGoogle: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectGoogle),
  openFolder: (folder: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.openFolder, folder),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: DownloadProgress,
    ) => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.downloadProgress, listener);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.downloadProgress, listener);
  },
  downloadVideo: (request: DownloadRequest): Promise<DownloadResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.downloadVideo, request),
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.selectFolder),
});
