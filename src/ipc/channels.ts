// Defines the IPC channel names shared by the main and preload processes.

export const IPC_CHANNELS = {
  // Opens Google's browser-based folder Picker.
  selectDriveFolder: 'select-drive-folder',
  // Opens the selected Drive folder in the browser.
  openDriveFolder: 'open-drive-folder',
  // Selects local files with a native dialog and uploads them to Drive.
  uploadFiles: 'upload-files',
  // Reads the non-sensitive Google connection state.
  googleStatus: 'google-status',
  // Starts desktop OAuth sign-in.
  connectGoogle: 'connect-google',
  // Revokes the connected Google account.
  disconnectGoogle: 'disconnect-google',
  selectFolder: 'select-folder',
  downloadVideo: 'download-video',
  downloadProgress: 'download-progress',
  openFolder: 'open-folder',
} as const;
