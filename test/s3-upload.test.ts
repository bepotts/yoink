// Verifies real streamed HTTP uploads against a local backend stand-in.
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  requireS3Destination,
  uploadS3File,
} from '../src/cloud-storage/s3/upload';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    createReadStream: vi.fn<typeof original.createReadStream>(
      original.createReadStream,
    ),
  };
});

test('streams multipart file bytes and only completes after backend success', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'yoink-upload-'));
  const source = path.join(folder, 'video.mp4');
  await writeFile(source, 'test-video-bytes');
  let status = 201;
  let received = '';
  const requestIds: string[] = [];
  const server = createServer(async (request, response) => {
    requestIds.push(String(request.headers['x-request-id']));
    if (request.method === 'GET') {
      response.end('{}');
      return;
    }
    for await (const chunk of request) received += chunk.toString();
    response.writeHead(status).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const destination = { backendUrl: `http://127.0.0.1:${address.port}` };
  try {
    await requireS3Destination(destination);
    const progress = vi.fn<(percent: number) => void>();
    await uploadS3File(source, destination, progress);
    expect(received).toContain('name="file"; filename="video.mp4"');
    expect(received).toContain('test-video-bytes');
    expect(progress).toHaveBeenLastCalledWith(100);
    status = 502;
    await expect(uploadS3File(source, destination)).rejects.toThrow(
      'Backend S3 upload failed',
    );
    expect(requestIds).toHaveLength(3);
    expect(new Set(requestIds).size).toBe(3);
    for (const requestId of requestIds) {
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
    await writeFile(source, '');
    await expect(uploadS3File(source, destination)).rejects.toThrow('nonempty');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(folder, { recursive: true, force: true });
  }
});

for (const size of [3, 9]) {
  test(`rejects a changed file size (${size} streamed bytes for 6 advertised bytes)`, async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'yoink-changed-upload-'));
    const source = path.join(folder, 'video.mp4');
    await writeFile(source, '123456');
    const body = Readable.from([Buffer.alloc(size, 'x')]);
    vi.mocked(createReadStream).mockReturnValueOnce(
      body as ReturnType<typeof createReadStream>,
    );
    let received = '';
    const server = createServer((request, response) => {
      request.on('data', (chunk) => {
        received += chunk.toString();
      });
      request.on('error', () => {});
      request.on('end', () => response.writeHead(201).end('{}'));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing port');
    const progress = vi.fn<(percent: number) => void>();
    try {
      await expect(
        uploadS3File(
          source,
          { backendUrl: `http://127.0.0.1:${address.port}` },
          progress,
        ),
      ).rejects.toThrow('changed size');
      expect(progress).not.toHaveBeenCalledWith(100);
      expect(body.destroyed).toBe(true);
      expect(received).not.toContain('x'.repeat(9));
      expect(received).not.toMatch(/--\r\n$/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(folder, { recursive: true, force: true });
    }
  });
}
