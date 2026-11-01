// Defines download request and result types and validates link and folder input.

export interface DownloadRequest {
  link: string;
  folder: string;
}

export type DownloadResult =
  | { success: true }
  | { success: false; error: string };

export function validateDownload(request: DownloadRequest): string | null {
  if (!request.link.trim()) return 'Please enter a video link.';
  try {
    const url = new URL(request.link.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return 'Please enter a valid HTTP or HTTPS link.';
  }
  if (!request.folder.trim()) return 'Please select a folder.';
  return null;
}
