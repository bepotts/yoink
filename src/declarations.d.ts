// Declares Vite globals, CSS imports, and the preload API available on window.

/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  // Restricted main-process operations available to the UI.
  yoink: {
    // Opens Google's folder Picker without exposing OAuth tokens.
    selectDriveFolder: () => Promise<
      import('./google/types/drive-types').DriveFolder | null
    >;
    // Opens a Drive folder in the default browser.
    openDriveFolder: (id: string) => Promise<string>;
    // Shows the native source picker and uploads selected files.
    uploadFiles: (
      folderId: string,
    ) => Promise<import('./ipc/download-types').DownloadResult | null>;
    // Reports the saved Google account connection.
    googleStatus: () => Promise<
      import('./google/types/account-types').GoogleAccountStatus
    >;
    // Opens Google sign-in in the system browser.
    connectGoogle: () => Promise<
      import('./google/types/account-types').GoogleAccountStatus
    >;
    // Revokes and removes Google account credentials.
    disconnectGoogle: () => Promise<
      import('./google/types/account-types').GoogleAccountStatus
    >;
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

// Public installed-application OAuth configuration injected into the main build.
declare const GOOGLE_CLIENT_ID: string;
// Google-issued desktop client secret; user credentials are stored separately.
declare const GOOGLE_CLIENT_SECRET: string;
