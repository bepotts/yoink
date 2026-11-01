// Validates the destination and runs yt-dlp to download a video, reporting failures.

import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { parseProgress } from './download-progress';
import {
  validateDownload,
  type DownloadRequest,
  type DownloadResult,
  type DownloadProgress,
} from './shared/download';

const run = promisify(execFile);

export async function downloadVideo(
  request: DownloadRequest,
  onProgress: (progress: DownloadProgress) => void = () => {},
): Promise<DownloadResult> {
  const error = validateDownload(request);
  if (error) return { success: false, error };

  try {
    if (!(await stat(request.folder)).isDirectory()) throw new Error();
    await access(request.folder, constants.W_OK);
  } catch {
    return {
      success: false,
      error:
        'The selected folder is unavailable or not writable. Please select another folder.',
    };
  }

  // Finder-launched macOS apps may not inherit Homebrew's PATH.
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    env.PATH = `${env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`;
  }

  try {
    const download = run(
      'yt-dlp',
      [
        '--ignore-config',
        '--no-playlist',
        '--newline',
        '--progress',
        '--progress-template',
        'download:yoink-progress:%(progress)j',
        '--progress-template',
        'postprocess:yoink-processing',
        '--paths',
        request.folder,
        '--',
        request.link.trim(),
      ],
      { env, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );
    const lines = download.child?.stdout
      ? createInterface({ input: download.child.stdout })
      : null;
    lines?.on('line', (line) => {
      const progress = parseProgress(line);
      if (progress) onProgress(progress);
    });
    try {
      await download;
    } finally {
      lines?.close();
    }
    return { success: true };
  } catch (cause) {
    const failure = cause as { code?: string; stderr?: string };
    return {
      success: false,
      error:
        failure.code === 'ENOENT'
          ? 'yt-dlp was not found. Install yt-dlp and restart Yoink.'
          : failure.stderr?.trim().slice(-2000) ||
            'Download failed. Please check the link and try again.',
    };
  }
}
