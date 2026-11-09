// Verifies folder permission checks and streamed Drive uploads.

import { beforeEach, expect, test, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { requireDriveFolder, uploadDriveFile } from '../src/google/drive';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(...args: unknown[]) => Promise<{ data: object }>>(),
  create: vi.fn<(...args: unknown[]) => Promise<object>>(),
  stream: vi.fn<(...args: unknown[]) => unknown>(),
}));
vi.mock('../src/google/account', () => ({
  createDriveClient: async () => ({
    files: {
      get: mocks.get,
      create: mocks.create,
    },
  }),
}));
vi.mock('node:fs', () => ({
  createReadStream: mocks.stream,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({
    data: {
      id: 'folder-1',
      name: 'Videos',
      mimeType: 'application/vnd.google-apps.folder',
      capabilities: { /* Can create files here. */ canAddChildren: true },
    },
  });
  mocks.create.mockResolvedValue({});
  mocks.stream.mockReturnValue(new PassThrough());
});

test('rejects a file or read-only folder as a destination', async () => {
  mocks.get.mockResolvedValue({
    data: {
      mimeType: 'video/mp4',
    },
  });
  await expect(requireDriveFolder('file-1')).rejects.toThrow(
    'does not allow uploads',
  );
});

test('streams into the chosen folder and never updates an existing file', async () => {
  await uploadDriveFile('/tmp/video.mp4', 'folder-1');
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      requestBody: {
        name: 'video.mp4',
        parents: ['folder-1'],
      },
      supportsAllDrives: true,
    }),
    { /* Avoid duplicate create retries. */ retry: false },
  );
  expect(mocks.stream).toHaveBeenCalledWith('/tmp/video.mp4');
});

test('never opens a source stream for an unwritable destination', async () => {
  mocks.get.mockRejectedValue(new Error('permission denied'));
  await expect(uploadDriveFile('/tmp/video.mp4', 'folder-1')).rejects.toThrow(
    'permission denied',
  );
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
