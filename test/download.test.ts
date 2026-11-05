// Tests download validation, yt-dlp arguments, destination checks, and failure messages.

import { beforeEach, expect, test, vi } from 'vitest';
import { downloadVideo } from '../src/ipc/download';
import type { ExecFileOptions } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { DownloadProgress } from '../src/ipc/download-types';

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
  mkdtemp: vi.fn<() => Promise<string>>(),
  readdir: vi.fn<() => Promise<object[]>>(),
  rm: vi.fn<() => Promise<void>>(),
  save: vi.fn<() => Promise<string>>(),
}));
vi.mock('node:child_process', () => ({ execFile: mocks.run }));
vi.mock('node:util', () => ({ promisify: () => mocks.run }));
vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  access: mocks.access,
  mkdtemp: mocks.mkdtemp,
  readdir: mocks.readdir,
  rm: mocks.rm,
}));
vi.mock('../src/ipc/save-download', () => ({ saveDownload: mocks.save }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.stat.mockResolvedValue({ isDirectory: () => true });
  mocks.access.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({});
  mocks.mkdtemp.mockResolvedValue('/tmp/My Folder/.yoink-test');
  mocks.readdir.mockResolvedValue([{ name: 'video.mp4', isFile: () => true }]);
  mocks.rm.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue('/tmp/My Folder/video.mp4');
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
      '--newline',
      '--progress',
      '--progress-template',
      'download:yoink-progress:%(progress)j',
      '--progress-template',
      'postprocess:yoink-processing',
      '--paths',
      '/tmp/My Folder/.yoink-test',
      '--',
      link,
    ],
    expect.objectContaining({ windowsHide: true }),
  );
  expect(mocks.run.mock.calls[0][2].shell).toBeUndefined();
  expect(mocks.save).toHaveBeenCalledWith(
    '/tmp/My Folder/.yoink-test/video.mp4',
    '/tmp/My Folder',
  );
  expect(mocks.rm).toHaveBeenCalledWith('/tmp/My Folder/.yoink-test', {
    recursive: true,
    force: true,
  });
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
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledOnce();
});

test('streams progress updates before the download completes', async () => {
  const stdout = new PassThrough();
  let complete!: (value: object) => void;
  mocks.run.mockReturnValue(
    Object.assign(
      new Promise<object>((resolve) => {
        complete = resolve;
      }),
      { child: { stdout } },
    ),
  );
  const onProgress = vi.fn<(progress: DownloadProgress) => void>();
  const result = downloadVideo(
    { link: 'https://example.com', folder: '/tmp' },
    onProgress,
  );
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalled());
  stdout.write('yoink-progress:{"downloaded_bytes":');
  expect(onProgress).not.toHaveBeenCalled();
  stdout.write('50,"total_bytes":100}\n');
  expect(onProgress).toHaveBeenCalledWith({
    phase: 'downloading',
    percent: 50,
  });
  stdout.end('yoink-processing\n');
  expect(onProgress).toHaveBeenLastCalledWith({
    phase: 'processing',
    percent: null,
  });
  complete({});
  await expect(result).resolves.toEqual({ success: true });
});
