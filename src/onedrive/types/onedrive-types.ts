// Defines renderer-safe OneDrive accounts, folders, and folder-list responses.

export interface OneDriveStatus {
  // Whether a Microsoft account is saved locally.
  connected: boolean;
  // Actionable failure without authentication payloads.
  error?: string;
}

export interface OneDriveFolder {
  // Canonical item identifier within the user's own OneDrive.
  id: string;
  // Display name for the chosen folder.
  name: string;
}

export interface OneDriveFolderPage {
  // Folder currently being browsed.
  folder: OneDriveFolder;
  // Immediate child folders; ordinary files are excluded.
  folders: OneDriveFolder[];
  // Graph continuation URL validated in the main process before use.
  nextPage?: string;
}
