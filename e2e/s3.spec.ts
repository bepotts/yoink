// Exercises native S3 uploads through the renderer, preload, IPC handler, and HTTP backend.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { expect, test } from './fixtures';

test('restores upload controls after cancellation, success, and backend failure', async ({
  app,
}, testInfo) => {
  const folder = testInfo.outputPath('videos');
  const source = testInfo.outputPath('videos', 'sample.mp4');
  await mkdir(folder, { recursive: true });
  await writeFile(source, 'original-video-bytes');
  let status = 201;
  const uploads: string[] = [];
  let readinessChecks = 0;
  let finishUpload: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    if (request.url !== '/uploads/s3') {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET') {
      readinessChecks++;
      response.end('{}');
      return;
    }
    let received = '';
    for await (const chunk of request) received += chunk.toString();
    uploads.push(received);
    finishUpload = () => response.writeHead(status).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing backend port');
  try {
    await app.evaluate(
      ({ dialog, BrowserWindow }, { backendUrl, source: selectedSource }) => {
        process.env.YOINK_BACKEND_URL = backendUrl;
        let selections = 0;
        dialog.showOpenDialog = async (owner, options) => {
          if (
            !(owner instanceof BrowserWindow) ||
            options?.properties?.join(',') !== 'openFile' ||
            !options.filters?.some((filter) =>
              filter.extensions.includes('mp4'),
            )
          )
            throw new Error('Expected an owned video file picker');
          selections++;
          return selections === 1
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [selectedSource] };
        };
      },
      { backendUrl: `http://127.0.0.1:${address.port}`, source },
    );
    const window = await app.firstWindow();
    const storage = window.getByLabel('Save to');
    await storage.selectOption('s3');
    const upload = window.getByRole('button', {
      name: 'Upload a video from computer',
      exact: true,
    });
    const submit = window.getByRole('button', { name: 'Submit', exact: true });
    const progress = window.getByRole('progressbar', {
      name: 'Download progress',
    });
    await upload.click();
    await expect(window.locator('#download-status')).toHaveText(
      'Upload cancelled.',
    );
    await expect(upload).toBeEnabled();
    await expect(storage).toBeEnabled();
    await expect(submit).toBeEnabled();
    await expect(progress).toHaveCount(0);
    expect(readinessChecks).toBe(0);
    expect(uploads).toHaveLength(0);
    for (const responseStatus of [201, 502]) {
      status = responseStatus;
      finishUpload = undefined;
      await upload.click();
      await expect.poll(() => Boolean(finishUpload)).toBe(true);
      await expect(upload).toBeDisabled();
      await expect(storage).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(progress).toBeVisible();
      finishUpload!();
      await expect(window.locator('#download-status')).toHaveText(
        responseStatus === 201
          ? 'Upload complete. Video saved to Amazon S3.'
          : 'S3 upload failed. Check the backend connection, bucket configuration, and AWS permissions. Your original video remains on your computer.',
      );
      await expect(upload).toBeEnabled();
      await expect(storage).toBeEnabled();
      await expect(submit).toBeEnabled();
      await expect(progress).toHaveCount(0);
      expect(await readFile(source, 'utf8')).toBe('original-video-bytes');
    }
    expect(readinessChecks).toBe(2);
    expect(uploads).toHaveLength(2);
    for (const body of uploads) {
      expect(body).toContain('name="file"; filename="sample.mp4"');
      expect(body).toContain('original-video-bytes');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
