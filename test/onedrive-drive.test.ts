// Verifies folder-only OneDrive browsing, safe pagination, chunk uploads, and failed-session cleanup.

import { beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listOneDriveFolders,
  uploadOneDriveFile,
  requireOneDriveFolder,
} from '../src/onedrive/drive';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  token: vi.fn<() => Promise<string>>(),
}));
vi.mock('../src/onedrive/account', () => ({
  oneDriveAccessToken: mocks.token,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.token.mockResolvedValue('synthetic-token');
});

// Provides the minimal Microsoft Graph metadata for a real folder.
function folder() {
  return Response.json({
    id: 'folder-1',
    name: 'Videos',
    folder: {},
  });
}

test('lists direct child folders and retains continuation past pages containing files', async () => {
  mocks.fetch.mockResolvedValueOnce(folder()).mockResolvedValueOnce(
    Response.json({
      value: [
        {
          id: 'subfolder',
          name: 'Subfolder',
          folder: {},
        },
        { /* Ordinary file ID. */ id: 'video', name: 'video.mp4' },
      ],
      '@odata.nextLink':
        'https://graph.microsoft.com/v1.0/me/drive/items/folder-1/children?$skiptoken=next',
    }),
  );
  const page = await listOneDriveFolders('root');
  expect(page.folders).toEqual([
    {
      id: 'subfolder',
      name: 'Subfolder',
    },
  ]);
  expect(page.nextPage).toContain('skiptoken=next');
  expect(String(mocks.fetch.mock.calls[1][0])).toContain(
    '/items/folder-1/children',
  );
});

test('rejects a pagination URL on another host without sending credentials to it', async () => {
  mocks.fetch.mockResolvedValueOnce(folder());
  await expect(
    listOneDriveFolders('root', 'https://attacker.example/steal'),
  ).rejects.toThrow('Invalid OneDrive');
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

test('rejects ordinary files as OneDrive destinations', async () => {
  mocks.fetch.mockResolvedValueOnce(
    Response.json({ /* A file has no folder facet. */ id: 'video' }),
  );
  await expect(requireOneDriveFolder('video')).rejects.toThrow(
    'folder is unavailable',
  );
});

test.each([false, true])(
  'uploads aligned chunks without leaking the Graph bearer token (failure: %s)',
  async (fail) => {
    const temporary = await mkdtemp(
      path.join(tmpdir(), 'yoink-onedrive-test-'),
    );
    try {
      const file = path.join(temporary, 'video.mp4');
      const chunk = 10 * 320 * 1024;
      await writeFile(file, Buffer.alloc(chunk + 10));
      mocks.fetch
        .mockResolvedValueOnce(folder())
        .mockResolvedValueOnce(
          Response.json({
            uploadUrl: 'https://uploads.example.test/session',
          }),
        )
        .mockResolvedValueOnce(
          new Response('', { /* First complete chunk. */ status: 202 }),
        )
        .mockResolvedValueOnce(
          new Response('', {
            status: fail ? 500 : 201,
          }),
        )
        .mockResolvedValueOnce(
          new Response(null, { /* Abandoned session cleanup. */ status: 204 }),
        );
      const operation = uploadOneDriveFile(file, 'folder-1');
      // Normalize both success and failure without conditional assertions.
      const result = await operation.then(
        () => 'complete',
        () => 'failed',
      );
      expect(result).toBe(fail ? 'failed' : 'complete');
      const upload = mocks.fetch.mock.calls[2][1]!;
      expect(upload.headers).toEqual({
        'Content-Length': String(chunk),
        'Content-Range': `bytes 0-${chunk - 1}/${chunk + 10}`,
      });
      expect(mocks.fetch.mock.calls[3][1]?.headers).toEqual({
        'Content-Length': '10',
        'Content-Range': `bytes ${chunk}-${chunk + 9}/${chunk + 10}`,
      });
      expect(mocks.fetch.mock.calls[1][1]?.body).toContain(
        '"@microsoft.graph.conflictBehavior":"rename"',
      );
      expect(mocks.fetch.mock.calls.length).toBe(fail ? 5 : 4);
    } finally {
      await rm(temporary, {
        recursive: true,
        force: true,
      });
    }
  },
);
