// Verifies Dropbox folder-only browsing, Unicode-safe session uploads, and root/path validation.

import { beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Dropbox } from 'dropbox';
import {
  listDropboxFolders,
  uploadDropboxFile,
  requireDropboxFolder,
  dropboxFolderUrl,
} from '../src/cloud-storage/dropbox/drive';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock('../src/cloud-storage/dropbox/account', () => ({
  createDropboxClient: async () =>
    new Dropbox({
      accessToken: 'synthetic-access',
      fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        mocks.fetch(input, init),
    }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
});

// Returns a real folder facet in the Dropbox response format.
function folder() {
  return Response.json({
    '.tag': 'folder',
    name: 'Videos',
    path_lower: '/videos',
  });
}

test('lists only direct child folders and keeps pagination', async () => {
  mocks.fetch.mockResolvedValueOnce(folder()).mockResolvedValueOnce(
    Response.json({
      entries: [
        { '.tag': 'folder', name: 'Clips', path_lower: '/videos/clips' },
        { '.tag': 'file', name: 'video.mp4', path_lower: '/videos/video.mp4' },
      ],
      has_more: true,
      cursor: 'next-cursor',
    }),
  );
  expect(await listDropboxFolders('/videos')).toEqual({
    folder: { path: '/videos', name: 'Videos' },
    folders: [{ path: '/videos/clips', name: 'Clips' }],
    cursor: 'next-cursor',
  });
  expect(mocks.fetch.mock.calls[1][1]?.body).toContain('"recursive":false');
});

test('uses only the fixed Dropbox continuation endpoint for opaque cursors', async () => {
  mocks.fetch
    .mockResolvedValueOnce(folder())
    .mockResolvedValueOnce(
      Response.json({ entries: [], has_more: false, cursor: 'end' }),
    );
  await listDropboxFolders('/videos', 'https://untrusted.example/not-a-url');
  expect(mocks.fetch.mock.calls[1][0]).toBe(
    'https://api.dropboxapi.com/2/files/list_folder/continue',
  );
});

test('rejects files as Dropbox destinations', async () => {
  mocks.fetch.mockResolvedValueOnce(
    Response.json({ '.tag': 'file', name: 'video.mp4' }),
  );
  await expect(requireDropboxFolder('/video.mp4')).rejects.toThrow(
    'not a folder',
  );
});

test.each([
  'relative',
  '/videos/../other',
  '/videos/',
  '//videos',
  '/bad\0name',
])('rejects malformed folder paths: %s', (folderPath) => {
  expect(() => dropboxFolderUrl(folderPath)).toThrow('valid Dropbox folder');
});

test('encodes browser paths rather than accepting arbitrary URLs', () => {
  expect(dropboxFolderUrl('/videos/#clips')).toBe(
    'https://www.dropbox.com/home/videos/%23clips',
  );
  expect(dropboxFolderUrl('')).toBe('https://www.dropbox.com/home');
});

test.each([false, true])(
  'uploads multiple bounded chunks without overwriting existing names (failure: %s)',
  async (fail) => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'yoink-dropbox-test-'));
    try {
      const file = path.join(temporary, 'vidéo.mp4');
      const chunk = 8 * 1024 * 1024;
      await writeFile(file, Buffer.alloc(chunk + 5));
      mocks.fetch
        .mockResolvedValueOnce(folder())
        .mockResolvedValueOnce(Response.json({ session_id: 'session-1' }))
        .mockResolvedValueOnce(new Response(''))
        .mockResolvedValueOnce(
          new Response(fail ? 'quota error' : '{}', {
            status: fail ? 409 : 200,
          }),
        );
      const outcome = await uploadDropboxFile(file, '/videos').then(
        () => 'complete',
        () => 'failed',
      );
      expect(outcome).toBe(fail ? 'failed' : 'complete');
      expect(mocks.fetch.mock.calls[1][0]).toBe(
        'https://content.dropboxapi.com/2/files/upload_session/start',
      );
      expect(mocks.fetch.mock.calls[2][0]).toBe(
        'https://content.dropboxapi.com/2/files/upload_session/append_v2',
      );
      expect(mocks.fetch.mock.calls[3][0]).toBe(
        'https://content.dropboxapi.com/2/files/upload_session/finish',
      );
      const header = new Headers(mocks.fetch.mock.calls[3][1]?.headers).get(
        'Dropbox-API-Arg',
      )!;
      expect(header).not.toContain('é');
      expect(JSON.parse(header)).toMatchObject({
        cursor: { session_id: 'session-1', offset: chunk },
        commit: {
          path: '/videos/vidéo.mp4',
          mode: { '.tag': 'add' },
          autorename: true,
        },
      });
      expect(mocks.fetch.mock.calls[2][1]?.body).toHaveProperty(
        'byteLength',
        chunk,
      );
      expect(mocks.fetch.mock.calls[3][1]?.body).toHaveProperty(
        'byteLength',
        5,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test('the SDK retries a transient session failure and reports committed upload progress', async () => {
  const temporary = await mkdtemp(
    path.join(tmpdir(), 'yoink-dropbox-sdk-test-'),
  );
  try {
    const file = path.join(temporary, 'video.mp4');
    const chunk = 8 * 1024 * 1024;
    await writeFile(file, Buffer.alloc(chunk + 5));
    mocks.fetch
      .mockResolvedValueOnce(folder())
      .mockResolvedValueOnce(Response.json({ session_id: 'session-retry' }))
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(Response.json({ id: 'uploaded-file' }));
    const progress = vi.fn<(percent: number) => void>();
    await uploadDropboxFile(file, '/videos', progress);
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    expect(mocks.fetch.mock.calls[2][0]).toBe(mocks.fetch.mock.calls[3][0]);
    expect(
      JSON.parse(
        new Headers(mocks.fetch.mock.calls[3][1]?.headers).get(
          'Dropbox-API-Arg',
        )!,
      ),
    ).toMatchObject({ cursor: { session_id: 'session-retry', offset: 0 } });
    expect(progress).toHaveBeenLastCalledWith(100);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
