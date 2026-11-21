// Verifies packaged and development downloads resolve to bundled binaries on each platform.
import { afterEach, expect, test, vi } from 'vitest';
import path from 'node:path';
import manifest from '../vendor/yt-dlp/manifest.json';
import { ytDlpPath, ytDlpVersion } from '../src/ipc/yt-dlp';

const electron = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/project' },
}));
vi.mock('electron', () => electron);

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  ['darwin', 'arm64', 'yt-dlp'],
  ['darwin', 'x64', 'yt-dlp'],
  ['linux', 'x64', 'yt-dlp'],
  ['linux', 'arm64', 'yt-dlp'],
  ['win32', 'x64', 'yt-dlp.exe'],
  ['win32', 'arm64', 'yt-dlp.exe'],
])('resolves prepared resources for %s-%s', (platform, arch, filename) => {
  electron.app.isPackaged = false;
  vi.stubGlobal('process', { platform, arch, resourcesPath: '/resources' });
  expect(ytDlpPath()).toBe(
    path.join(
      '/project',
      'vendor/yt-dlp/bin',
      `${platform}-${arch}`,
      'yt-dlp',
      filename,
    ),
  );
});

test.each([
  ['darwin', 'yt-dlp'],
  ['linux', 'yt-dlp'],
  ['win32', 'yt-dlp.exe'],
])(
  'uses resources outside app.asar for packaged %s builds',
  (platform, filename) => {
    electron.app.isPackaged = true;
    vi.stubGlobal('process', {
      platform,
      arch: 'x64',
      resourcesPath: '/installed/resources',
    });
    expect(ytDlpPath()).toBe(
      path.join('/installed/resources', 'yt-dlp', filename),
    );
  },
);

test('reports the same pinned version used by the build', () => {
  expect(ytDlpVersion).toBe(manifest.version);
  expect(ytDlpVersion).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
});
