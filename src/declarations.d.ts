// Declares Vite globals, CSS imports, and the preload API available on window.

/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  // Restricted main-process operations available to the UI.
  yoink: {
    // Reports locally saved Microsoft connection state.
    oneDriveStatus: () => Promise<
      import('./onedrive/types/onedrive-types').OneDriveStatus
    >;
    // Starts desktop Microsoft OAuth.
    connectOneDrive: () => Promise<
      import('./onedrive/types/onedrive-types').OneDriveStatus
    >;
    // Removes the Microsoft account from this app.
    disconnectOneDrive: () => Promise<
      import('./onedrive/types/onedrive-types').OneDriveStatus
    >;
    // Browses OneDrive folders hierarchically.
    listOneDriveFolders: (
      id: string,
      nextPage?: string,
    ) => Promise<import('./onedrive/types/onedrive-types').OneDriveFolderPage>;
    // Opens the user's OneDrive folder in a browser.
    openOneDriveFolder: (id: string) => Promise<string>;
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

// Public desktop application ID injected only into the main-process build.
declare const MICROSOFT_CLIENT_ID: string;

// Microsoft account audience or tenant ID injected into the main-process build.
declare const MICROSOFT_TENANT_ID: string;
