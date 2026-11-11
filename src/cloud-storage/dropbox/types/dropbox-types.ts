// Defines renderer-safe Dropbox status, folder metadata, and encrypted token data.

export interface DropboxStatus {
  // Whether Dropbox credentials are saved locally.
  connected: boolean;
  // Safe connection or disconnect guidance.
  error?: string;
}

export interface DropboxFolder {
  // Dropbox folder path; the empty string represents the account root.
  path: string;
  // User-facing folder name.
  name: string;
}

export interface DropboxFolderPage {
  // Folder currently being browsed.
  folder: DropboxFolder;
  // Immediate subfolders, excluding ordinary files.
  folders: DropboxFolder[];
  // Opaque continuation cursor for additional results.
  cursor?: string;
}

export interface DropboxTokens {
  // Short-lived credential used exclusively in the main process.
  accessToken: string;
  // Offline refresh credential encrypted on disk.
  refreshToken: string;
  // Epoch milliseconds after which the access token must be refreshed.
  expiresAt: number;
}

export interface DropboxTokenResponse {
  // Dropbox-issued access credential.
  access_token?: string;
  // Offline refresh credential returned during initial consent.
  refresh_token?: string;
  // Access-token lifetime in seconds.
  expires_in?: number;
}
