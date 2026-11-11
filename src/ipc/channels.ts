// Defines the IPC channel names shared by the main and preload processes.

export const IPC_CHANNELS = {
  dropboxStatus: 'dropbox-status',
  connectDropbox: 'connect-dropbox',
  disconnectDropbox: 'disconnect-dropbox',
  listDropboxFolders: 'list-dropbox-folders',
  openDropboxFolder: 'open-dropbox-folder',
  oneDriveStatus: 'onedrive-status',
  connectOneDrive: 'connect-onedrive',
  disconnectOneDrive: 'disconnect-onedrive',
  listOneDriveFolders: 'list-onedrive-folders',
  openOneDriveFolder: 'open-onedrive-folder',
  selectDriveFolder: 'select-drive-folder',
  openDriveFolder: 'open-drive-folder',
  uploadFiles: 'upload-files',
  googleStatus: 'google-status',
  connectGoogle: 'connect-google',
  disconnectGoogle: 'disconnect-google',
  selectFolder: 'select-folder',
  downloadVideo: 'download-video',
  downloadProgress: 'download-progress',
  openFolder: 'open-folder',
} as const;
