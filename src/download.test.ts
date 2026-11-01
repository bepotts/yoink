// Tests download validation, yt-dlp arguments, destination checks, and failure messages.

import { beforeEach, expect, test, vi } from 'vitest';
import { downloadVideo } from './download';
import type { ExecFileOptions } from 'node:child_process';

const mocks = vi.hoisted(() => ({
  run: vi.fn<
    (
      command: string,
      args: string[],
      options: ExecFileOptions,
    ) => Promise<object>
  >(),
  stat: vi.fn<() => Promise<{ isDirectory: () => boolean }>>(),
  access: vi.fn<() => Promise<void>>(),
}));
vi.mock('node:child_process', () => ({ execFile: mocks.run }));
vi.mock('node:util', () => ({ promisify: () => mocks.run }));
vi.mock('node:fs/promises', () => ({ stat: mocks.stat, access: mocks.access }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.stat.mockResolvedValue({ isDirectory: () => true });
  mocks.access.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({});
});

test.each([
  ['', '/tmp', 'Please enter a video link.'],
  ['   ', '/tmp', 'Please enter a video link.'],
  ['https://example.com', '', 'Please select a folder.'],
  ['bad link', '/tmp', 'Please enter a valid HTTP or HTTPS link.'],
  ['file:///tmp/video', '/tmp', 'Please enter a valid HTTP or HTTPS link.'],
])('rejects invalid input (%s, %s)', async (link, folder, error) => {
  await expect(downloadVideo({ link, folder })).resolves.toEqual({
    success: false,
    error,
  });
  expect(mocks.run).not.toHaveBeenCalled();
});

test('passes the URL and folder as separate arguments without a shell', async () => {
  const link = 'https://example.com/video?name=$(echo-test)&id=1';
  await expect(
    downloadVideo({ link: ` ${link} `, folder: '/tmp/My Folder' }),
  ).resolves.toEqual({ success: true });
  expect(mocks.run).toHaveBeenCalledWith(
    'yt-dlp',
    [
      '--ignore-config',
      '--no-playlist',
      '--no-progress',
      '--paths',
      '/tmp/My Folder',
      '--',
      link,
    ],
    expect.objectContaining({ windowsHide: true }),
  );
  expect(mocks.run.mock.calls[0][2].shell).toBeUndefined();
});

test('rejects an unavailable folder before starting yt-dlp', async () => {
  mocks.stat.mockRejectedValue(new Error('Missing directory'));
  expect(
    await downloadVideo({ link: 'https://example.com', folder: '/missing' }),
  ).toMatchObject({ success: false });
  expect(mocks.run).not.toHaveBeenCalled();
});

test('rejects a destination that is a file or is not writable', async () => {
  mocks.stat.mockResolvedValueOnce({ isDirectory: () => false });
  expect(
    await downloadVideo({ link: 'https://example.com', folder: '/file' }),
  ).toMatchObject({ success: false });
  mocks.access.mockRejectedValueOnce(new Error('Permission denied'));
  expect(
    await downloadVideo({ link: 'https://example.com', folder: '/readonly' }),
  ).toMatchObject({ success: false });
  expect(mocks.run).not.toHaveBeenCalled();
});

test('explains when yt-dlp is missing', async () => {
  mocks.run.mockRejectedValue({ code: 'ENOENT' });
  expect(
    await downloadVideo({ link: 'https://example.com', folder: '/tmp' }),
  ).toEqual({
    success: false,
    error: 'yt-dlp was not found. Install yt-dlp and restart Yoink.',
  });
});

test('returns yt-dlp failure details', async () => {
  mocks.run.mockRejectedValue({ code: 1, stderr: 'Video unavailable' });
  expect(
    await downloadVideo({ link: 'https://example.com', folder: '/tmp' }),
  ).toEqual({ success: false, error: 'Video unavailable' });
});
