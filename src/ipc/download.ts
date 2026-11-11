// Validates the destination and runs yt-dlp to download a video, reporting failures.

import log from 'electron-log/main';
import { execFile } from 'node:child_process';
import { access, stat, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  requireDropboxFolder,
  uploadDropboxFile,
} from '../cloud-storage/dropbox/drive';
import {
  requireOneDriveFolder,
  uploadOneDriveFile,
} from '../cloud-storage/onedrive/drive';
import {
  requireDriveFolder,
  uploadDriveFile,
} from '../cloud-storage/google/drive';
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
  if (error) {
    log.warn('Download rejected', error);
    return { success: false, error };
  }

  const cloud =
    request.dropboxFolderPath !== undefined
      ? 'Dropbox'
      : request.driveFolderId
        ? 'Google Drive'
        : request.oneDriveFolderId
          ? 'OneDrive'
          : null;
  log.info('Download started', { destination: cloud ?? 'local' });
  try {
    if (request.dropboxFolderPath !== undefined) {
      await requireDropboxFolder(request.dropboxFolderPath);
    } else if (request.oneDriveFolderId) {
      await requireOneDriveFolder(request.oneDriveFolderId);
    } else if (request.driveFolderId) {
      await requireDriveFolder(request.driveFolderId);
    } else {
      if (!(await stat(request.folder)).isDirectory()) throw new Error();
      await access(request.folder, constants.W_OK);
    }
  } catch {
    log.warn('Download destination unavailable', {
      destination: cloud ?? 'local',
    });
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
        if (request.dropboxFolderPath !== undefined) {
          await uploadDropboxFile(
            path.join(stagingFolder, file.name),
            request.dropboxFolderPath,
            (percent) => onProgress({ phase: 'uploading', percent }),
          );
        } else if (request.oneDriveFolderId) {
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
    log.info('Download completed', { destination: cloud ?? 'local' });
    return { success: true };
  } catch (cause) {
    // Avoid logging provider errors or yt-dlp arguments containing credentials and URLs.
    log.error(uploading ? 'Cloud upload failed' : 'Download failed', {
      destination: cloud ?? 'local',
      code:
        typeof (cause as NodeJS.ErrnoException)?.code === 'string'
          ? (cause as NodeJS.ErrnoException).code
          : undefined,
    });
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
      await rm(stagingFolder, { recursive: true, force: true }).catch(() => {
        log.warn('Could not clean up download temporary files');
      });
    }
  }
}
