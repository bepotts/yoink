// Defines the IPC channel names shared by the main and preload processes.

export const IPC_CHANNELS = {
  selectFolder: 'select-folder',
  downloadVideo: 'download-video',
  downloadProgress: 'download-progress',
  openFolder: 'open-folder',
} as const;
