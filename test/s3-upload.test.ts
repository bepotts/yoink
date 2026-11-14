// Verifies real streamed HTTP uploads against a local backend stand-in.
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  requireS3Destination,
  uploadS3File,
} from '../src/cloud-storage/s3/upload';

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
