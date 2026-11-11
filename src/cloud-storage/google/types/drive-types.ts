// Defines safe metadata for a selected Google Drive folder.

export interface DriveFolder {
  // Google Drive folder identifier, never a local filesystem path.
  id: string;
  // Display name returned by Google Drive.
  name: string;
}
