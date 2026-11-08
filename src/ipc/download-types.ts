// Defines download request and result types and validates link and folder input.

export interface DownloadRequest {
  // Video link to download.
  link: string;
  // Local destination; unused when a Drive folder is supplied.
  folder: string;
  // Drive destination replaces the local folder when provided.
  driveFolderId?: string;
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
