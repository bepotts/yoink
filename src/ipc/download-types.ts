// Defines download request and result types and validates link and folder input.

export interface DownloadRequest {
  // Video link to download.
  link: string;
  // Local destination; unused when a Drive folder is supplied.
  folder: string;
  // Drive destination replaces the local folder when provided.
  driveFolderId?: string;
  // OneDrive destination replaces local saving or Google Drive.
  oneDriveFolderId?: string;
  // Dropbox folder path; an empty string selects the Dropbox root.
  dropboxFolderPath?: string;
}

export interface DownloadProgress {
  // Active download or upload stage.
  phase: 'downloading' | 'processing' | 'uploading';
  // Known percentage or null for indeterminate progress.
  percent: number | null;
}

export type DownloadResult =
  | { success: true }
  | { success: false; error: string };

// Checks input before downloading to a local or Google Drive destination.
export function validateDownload(request: DownloadRequest): string | null {
  if (!request.link.trim()) return 'Please enter a video link.';
  try {
    const url = new URL(request.link.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return 'Please enter a valid HTTP or HTTPS link.';
  }
  if (
    [
      request.driveFolderId,
      request.oneDriveFolderId,
      request.dropboxFolderPath,
    ].filter((value) => value !== undefined).length > 1
  )
    return 'Please select only one cloud destination.';
  if (request.dropboxFolderPath !== undefined) {
    const folderPath = request.dropboxFolderPath;
    if (
      typeof folderPath !== 'string' ||
      folderPath.length > 2000 ||
      (folderPath !== '' &&
        (!folderPath.startsWith('/') ||
          folderPath.endsWith('/') ||
          folderPath.includes('//') ||
          folderPath.includes('\0') ||
          folderPath.split('/').some((part) => part === '.' || part === '..')))
    )
      return 'Please select a Dropbox folder.';
    return null;
  }
  if (request.oneDriveFolderId !== undefined) {
    if (
      typeof request.oneDriveFolderId !== 'string' ||
      !/^[a-zA-Z0-9!_-]{1,256}$/.test(request.oneDriveFolderId)
    )
      return 'Please select a OneDrive folder.';
    return null;
  }
  if (request.driveFolderId !== undefined) {
    if (
      typeof request.driveFolderId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(request.driveFolderId)
    )
      return 'Please select a Google Drive folder.';
    return null;
  }
  if (!request.folder.trim()) return 'Please select a folder.';
  return null;
}
