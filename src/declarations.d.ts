// Declares Vite globals, CSS imports, and the preload API available on window.

/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  yoink: {
    selectFolder: () => Promise<string | null>;
    downloadVideo: (
      request: import('./shared/download').DownloadRequest,
    ) => Promise<import('./shared/download').DownloadResult>;
  };
  versions: import('./shared/versions').Versions;
}
