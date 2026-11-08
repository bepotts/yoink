// Verifies folder permission checks and streamed Drive uploads.

import { beforeEach, expect, test, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { requireDriveFolder, uploadDriveFile } from '../src/google/drive';

const mocks = vi.hoisted(() => ({
  // Returns folder metadata.
  get: vi.fn<(...args: unknown[]) => Promise<{ data: object }>>(),
  // Acknowledges a new uploaded file.
  create: vi.fn<(...args: unknown[]) => Promise<object>>(),
  // Supplies source data without accessing real files.
  stream: vi.fn<(...args: unknown[]) => unknown>(),
}));
vi.mock('../src/google/account', () => ({
  // Restricts these tests to Drive behavior.
  createDriveClient: async () => ({
    // Drive file endpoints used by the uploader.
    files: {
      // Folder permission endpoint.
      get: mocks.get,
      // File upload endpoint.
      create: mocks.create,
    },
  }),
}));
vi.mock('node:fs', () => ({
  // Streams a test buffer instead of a local file.
  createReadStream: mocks.stream,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({
    // Writable Drive folder fixture.
    data: {
      // Canonical folder ID.
      id: 'folder-1',
      // Folder display name.
      name: 'Videos',
      // Drive folder MIME type.
      mimeType: 'application/vnd.google-apps.folder',
      // Upload permission.
      capabilities: { /* Can create files here. */ canAddChildren: true },
    },
  });
  mocks.create.mockResolvedValue({});
  mocks.stream.mockReturnValue(new PassThrough());
});

test('rejects a file or read-only folder as a destination', async () => {
  mocks.get.mockResolvedValue({
    /* Metadata for an ordinary file. */ data: {
      /* Not a folder. */ mimeType: 'video/mp4',
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
      // New-file metadata, rather than an update to an existing file.
      requestBody: {
        /* Preserve the filename. */ name: 'video.mp4',
        /* Explicit destination. */ parents: ['folder-1'],
      },
      // Shared drives are supported.
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
