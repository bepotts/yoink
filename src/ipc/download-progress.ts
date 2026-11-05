// Parses structured yt-dlp progress output into UI download updates.

import type { DownloadProgress } from './download-types';

export function parseProgress(line: string): DownloadProgress | null {
  if (line === 'yoink-processing')
    return { phase: 'processing', percent: null };
  if (!line.startsWith('yoink-progress:')) return null;
  try {
    const data = JSON.parse(line.slice('yoink-progress:'.length));
    if (data.status === 'finished')
      return { phase: 'processing', percent: null };
    const total = data.total_bytes || data.total_bytes_estimate;
    const percent =
      typeof total === 'number' &&
      total > 0 &&
      typeof data.downloaded_bytes === 'number'
        ? Math.max(0, Math.min(100, (data.downloaded_bytes / total) * 100))
        : null;
    return {
      phase: 'downloading',
      percent: Number.isFinite(percent) ? percent : null,
    };
  } catch {
    return null;
  }
}
