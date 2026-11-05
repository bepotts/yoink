// Declares Vite globals, CSS imports, and the preload API available on window.

/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  yoink: {
    openFolder: (folder: string) => Promise<string>;
    onDownloadProgress: (
      callback: (
        progress: import('./ipc/download-types').DownloadProgress,
      ) => void,
    ) => () => void;
    selectFolder: () => Promise<string | null>;
    downloadVideo: (
      request: import('./ipc/download-types').DownloadRequest,
    ) => Promise<import('./ipc/download-types').DownloadResult>;
  };
  versions: import('./shared/versions').Versions;
}
