// Verifies self-contained processing and JavaScript paths for packaged and development builds.
import { afterEach, expect, test, vi } from 'vitest';
import path from 'node:path';
import manifest from '../vendor/media-tools/manifest.json';
import { mediaToolPaths, mediaToolVersions } from '../src/ipc/media-tools';

const electron = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/project' },
}));
vi.mock('electron', () => electron);

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['win32', 'arm64'],
  ['win32', 'x64'],
])(
  'resolves bundled dependencies for %s-%s without PATH lookup',
  (platform, arch) => {
    vi.stubGlobal('process', { platform, arch, resourcesPath: '/resources' });
    electron.app.isPackaged = false;
    const native = path.join(
      '/project',
      'vendor/media-tools/bin',
      `${platform}-${arch}`,
      'media-tools',
      arch,
    );
    expect(mediaToolPaths()).toEqual({
      directory: native,
      deno: path.join(native, platform === 'win32' ? 'deno.exe' : 'deno'),
    });
    electron.app.isPackaged = true;
    const packaged = path.join('/resources', 'media-tools', arch);
    expect(mediaToolPaths()).toEqual({
      directory: packaged,
      deno: path.join(packaged, platform === 'win32' ? 'deno.exe' : 'deno'),
    });
  },
);

test('tracks the same dependency versions used by packaging', () => {
  expect(mediaToolVersions).toEqual({
    ffmpeg: manifest.ffmpeg.version,
    deno: manifest.deno.version,
  });
});
