// Streams local files to the backend, which performs the S3 transfer.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { validateS3Destination, type S3Destination } from './types';

// Validates the destination and constructs its upload endpoint.
function endpoint(destination: S3Destination): URL {
  const error = validateS3Destination(destination);
  if (error) throw new Error(error);
  return new URL(`${destination.backendUrl.replace(/\/+$/, '')}/uploads/s3`);
}

// Checks backend readiness before spending time downloading a video.
export async function requireS3Destination(
  destination: S3Destination,
): Promise<void> {
  const response = await fetch(endpoint(destination), {
    signal: AbortSignal.timeout(10000),
    headers: { 'X-Request-ID': randomUUID() },
  });
  if (!response.ok)
    throw new Error('The backend S3 destination is unavailable.');
}

// Streams multipart data with backpressure and reports completion after S3 succeeds.
export async function uploadS3File(
  source: string,
  destination: S3Destination,
  onProgress: (percent: number) => void = () => {},
): Promise<void> {
  const url = endpoint(destination);
  const file = await stat(source);
  if (!file.isFile() || file.size === 0)
    throw new Error('Choose a nonempty video file.');
  const boundary = `yoink-${randomUUID()}`;
  const name = path.basename(source).replace(/["\r\n\\]/g, '_');
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = createReadStream(source);
  // Yields bounded chunks while keeping progress below completion during the S3 stage.
  async function* multipart() {
    yield header;
    let sent = 0;
    for await (const chunk of body) {
      sent += (chunk as Buffer).length;
      onProgress(Math.min(99, (sent / file.size) * 100));
      yield chunk;
    }
    yield footer;
  }
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
    url,
    {
      method: 'POST',
      headers: {
        'X-Request-ID': randomUUID(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': header.length + file.size + footer.length,
      },
    },
  );
  const response = new Promise<void>((resolve, reject) => {
    request.on('error', reject);
    request.on('response', (incoming) => {
      incoming.resume();
      incoming.on('error', reject);
      incoming.on('end', () => {
        if (incoming.statusCode === 201) resolve();
        else
          reject(
            new Error(
              'Backend S3 upload failed. Check backend configuration and AWS permissions.',
            ),
          );
      });
    });
  });
  request.setTimeout(30 * 60 * 1000, () =>
    request.destroy(new Error('Upload timed out.')),
  );
  try {
    await Promise.all([
      pipeline(Readable.from(multipart()), request),
      response,
    ]);
    onProgress(100);
  } finally {
    body.destroy();
    request.destroy();
  }
}
