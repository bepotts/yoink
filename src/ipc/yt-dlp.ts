// Resolves the bundled yt-dlp executable without relying on the user's PATH.
import { app } from 'electron';
import path from 'node:path';
import manifest from '../../vendor/yt-dlp/manifest.json';

// Identifies the pinned downloader shipped with this application build.
export const ytDlpVersion = manifest.version;

// Uses unpacked application resources in releases and prepared resources during development.
export function ytDlpPath(): string {
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp')
    : path.join(
        app.getAppPath(),
        'vendor/yt-dlp/bin',
        `${process.platform}-${process.arch}`,
        'yt-dlp',
      );
  return path.join(
    directory,
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );
}
