// Checks collision handling against real files, including concurrent saves.

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { saveDownload } from '../src/ipc/save-download';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), 'yoink-save-test-'));
  folders.push(folder);
  const staging = path.join(folder, 'staging');
  await mkdir(staging);
  const source = path.join(staging, 'video.mp4');
  await writeFile(source, 'new video');
  return { folder, source };
}

test('keeps the original name when it is available', async () => {
  const { folder, source } = await setup();
  expect(await saveDownload(source, folder)).toBe(
    path.join(folder, 'video.mp4'),
  );
  expect(await readFile(path.join(folder, 'video.mp4'), 'utf8')).toBe(
    'new video',
  );
});

test('increments the suffix without changing existing files', async () => {
  const { folder, source } = await setup();
  await writeFile(path.join(folder, 'video.mp4'), 'original');
  await writeFile(path.join(folder, 'video (1).mp4'), 'first copy');
  expect(await saveDownload(source, folder)).toBe(
    path.join(folder, 'video (2).mp4'),
  );
  expect(await readFile(path.join(folder, 'video.mp4'), 'utf8')).toBe(
    'original',
  );
  expect(await readFile(path.join(folder, 'video (1).mp4'), 'utf8')).toBe(
    'first copy',
  );
  expect(await readFile(path.join(folder, 'video (2).mp4'), 'utf8')).toBe(
    'new video',
  );
});

test('concurrent saves use different filenames', async () => {
  const { folder, source } = await setup();
  const results = await Promise.all([
    saveDownload(source, folder),
    saveDownload(source, folder),
  ]);
  expect(new Set(results)).toEqual(
    new Set([
      path.join(folder, 'video.mp4'),
      path.join(folder, 'video (1).mp4'),
    ]),
  );
});

test('reports filesystem errors instead of retrying them as collisions', async () => {
  const { folder } = await setup();
  await expect(
    saveDownload(path.join(folder, 'missing.mp4'), folder),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
