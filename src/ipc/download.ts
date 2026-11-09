// Validates the destination and runs yt-dlp to download a video, reporting failures.

import { execFile } from 'node:child_process';
import { access, stat, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { requireOneDriveFolder, uploadOneDriveFile } from '../onedrive/drive';
import { requireDriveFolder, uploadDriveFile } from '../google/drive';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { parseProgress } from './download-progress';
import { saveDownload } from './save-download';
import {
  validateDownload,
  type DownloadRequest,
  type DownloadResult,
  type DownloadProgress,
} from './download-types';

const run = promisify(execFile);

// Downloads into staging, then saves locally or uploads to the selected Drive folder.
export async function downloadVideo(
  request: DownloadRequest,
  onProgress: (progress: DownloadProgress) => void = () => {},
): Promise<DownloadResult> {
  const error = validateDownload(request);
  if (error) return { success: false, error };

  const cloud = request.driveFolderId
    ? 'Google Drive'
    : request.oneDriveFolderId
      ? 'OneDrive'
      : null;
  try {
    if (request.oneDriveFolderId) {
      await requireOneDriveFolder(request.oneDriveFolderId);
    } else if (request.driveFolderId) {
      await requireDriveFolder(request.driveFolderId);
    } else {
      if (!(await stat(request.folder)).isDirectory()) throw new Error();
      await access(request.folder, constants.W_OK);
    }
  } catch {
    return {
      success: false,
      error: cloud
        ? `The ${cloud} folder is unavailable. Reconnect the account and select a writable folder.`
        : 'The selected folder is unavailable or not writable. Please select another folder.',
    };
  }

  // Finder-launched macOS apps may not inherit Homebrew's PATH.
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    env.PATH = `${env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`;
  }

  let stagingFolder: string | undefined;
  let uploading = false;
  let keepRecoveryCopy = false;
  try {
    // Download separately so yt-dlp never skips or overwrites an existing video.
    stagingFolder = await mkdtemp(
      path.join(cloud ? tmpdir() : request.folder, '.yoink-'),
    );
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
        stagingFolder,
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
    const files = await readdir(stagingFolder, { withFileTypes: true });
    if (!files.some((file) => file.isFile()))
      throw new Error('No downloaded file was produced.');
    if (cloud) {
      uploading = true;
      onProgress({
        phase: 'uploading',
        percent: null,
      });
    }
    for (const file of files) {
      if (file.isFile()) {
        if (request.oneDriveFolderId) {
          await uploadOneDriveFile(
            path.join(stagingFolder, file.name),
            request.oneDriveFolderId,
            (percent) =>
              onProgress({
                phase: 'uploading',
                percent,
              }),
          );
        } else if (request.driveFolderId) {
          await uploadDriveFile(
            path.join(stagingFolder, file.name),
            request.driveFolderId,
          );
        } else {
          await saveDownload(
            path.join(stagingFolder, file.name),
            request.folder,
          );
        }
      }
    }
    return { success: true };
  } catch (cause) {
    if (uploading) {
      keepRecoveryCopy = true;
      return {
        success: false,
        error: `${cloud} upload failed. Check your connection, storage space, and folder permissions. Downloaded files are kept at ${stagingFolder}. Some files may already have uploaded.`,
      };
    }
    const failure = cause as { code?: string; stderr?: string };
    return {
      success: false,
      error:
        failure.code === 'ENOENT'
          ? 'yt-dlp was not found. Install yt-dlp and restart Yoink.'
          : failure.stderr?.trim().slice(-2000) ||
            'Download failed. Please check the link and try again.',
    };
  } finally {
    if (stagingFolder && !keepRecoveryCopy) {
      await rm(stagingFolder, { recursive: true, force: true }).catch(
        (cause) => {
          console.warn('Could not clean up download temporary files:', cause);
        },
      );
    }
  }
}
