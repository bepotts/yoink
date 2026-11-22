// Resolves bundled media tools so downloads never require user-installed dependencies.
import { app } from 'electron';
import path from 'node:path';
import manifest from '../../vendor/media-tools/manifest.json';

// Identifies the versioned processing and JavaScript dependencies shipped with this build.
export const mediaToolVersions = {
  ffmpeg: manifest.ffmpeg.version,
  deno: manifest.deno.version,
};

// Returns paths in unpacked resources or the development cache for the current architecture.
export function mediaToolPaths(): { directory: string; deno: string } {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'media-tools')
    : path.join(
        app.getAppPath(),
        'vendor/media-tools/bin',
        `${process.platform}-${process.arch}`,
        'media-tools',
      );
  const directory = path.join(root, process.arch);
  return {
    directory,
    deno: path.join(
      directory,
      process.platform === 'win32' ? 'deno.exe' : 'deno',
    ),
  };
}
