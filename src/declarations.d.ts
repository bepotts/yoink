// Declares Vite globals, CSS imports, and the preload API available on window.

/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="vite/client" />
declare module '*.css';

interface Window {
  // Restricted main-process operations available to the UI.
  yoink: {
    // Reports the locally saved Dropbox connection.
    dropboxStatus: () => Promise<
      import('./cloud-storage/dropbox/types/dropbox-types').DropboxStatus
    >;
    // Opens Dropbox consent in the system browser.
    connectDropbox: () => Promise<
      import('./cloud-storage/dropbox/types/dropbox-types').DropboxStatus
    >;
    // Revokes and removes this app's Dropbox credentials.
    disconnectDropbox: () => Promise<
      import('./cloud-storage/dropbox/types/dropbox-types').DropboxStatus
    >;
    // Lists only immediate Dropbox child folders.
    listDropboxFolders: (
      folderPath: string,
      cursor?: string,
    ) => Promise<
      import('./cloud-storage/dropbox/types/dropbox-types').DropboxFolderPage
    >;
    // Opens a validated Dropbox folder path in the system browser.
    openDropboxFolder: (folderPath: string) => Promise<string>;
    // Reports locally saved Microsoft connection state.
    oneDriveStatus: () => Promise<
      import('./cloud-storage/onedrive/types/onedrive-types').OneDriveStatus
    >;
    // Starts desktop Microsoft OAuth.
    connectOneDrive: () => Promise<
      import('./cloud-storage/onedrive/types/onedrive-types').OneDriveStatus
    >;
    // Removes the Microsoft account from this app.
    disconnectOneDrive: () => Promise<
      import('./cloud-storage/onedrive/types/onedrive-types').OneDriveStatus
    >;
    // Browses OneDrive folders hierarchically.
    listOneDriveFolders: (
      id: string,
      nextPage?: string,
    ) => Promise<
      import('./cloud-storage/onedrive/types/onedrive-types').OneDriveFolderPage
    >;
    // Opens the user's OneDrive folder in a browser.
    openOneDriveFolder: (id: string) => Promise<string>;
    // Opens Google's folder Picker without exposing OAuth tokens.
    selectDriveFolder: () => Promise<
      import('./cloud-storage/google/types/drive-types').DriveFolder | null
    >;
    // Opens a Drive folder in the default browser.
    openDriveFolder: (id: string) => Promise<string>;
    // Shows the native source picker and uploads selected files.
    uploadFiles: (
      folderId: string,
    ) => Promise<import('./ipc/download-types').DownloadResult | null>;
    // Reports the saved Google account connection.
    googleStatus: () => Promise<
      import('./cloud-storage/google/types/account-types').GoogleAccountStatus
    >;
    // Opens Google sign-in in the system browser.
    connectGoogle: () => Promise<
      import('./cloud-storage/google/types/account-types').GoogleAccountStatus
    >;
    // Revokes and removes Google account credentials.
    disconnectGoogle: () => Promise<
      import('./cloud-storage/google/types/account-types').GoogleAccountStatus
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

// Public Dropbox OAuth application key injected into the main process.
declare const DROPBOX_APP_KEY: string;
// Exact registered IPv4 loopback callback used by Dropbox authorization.
declare const DROPBOX_REDIRECT_URI: string;

// Public Sentry ingestion DSN injected into the main build; never an authentication token.
declare const SENTRY_DSN: string;

// Enables renderer instrumentation when the main process has a configured DSN.
declare const SENTRY_ENABLED: boolean;
