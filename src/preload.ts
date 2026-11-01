// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/ipc';
import type { Versions } from './shared/versions';

const versions: Versions = {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
};

contextBridge.exposeInMainWorld('versions', versions);
contextBridge.exposeInMainWorld('yoink', {
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.selectFolder),
});
