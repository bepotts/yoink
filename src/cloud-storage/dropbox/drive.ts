// Browses Dropbox folders and uploads large videos with conflict-safe upload sessions.

import { fileUpload, uploadFile } from 'dropbox';
import path from 'node:path';
import { createDropboxClient } from './account';
import type { DropboxFolder, DropboxFolderPage } from './types/dropbox-types';

const CHUNK_SIZE = 8 * 1024 * 1024;

// Accepts the Dropbox root or an absolute folder path without traversal segments.
export function validateDropboxPath(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    (value !== '' &&
      (!value.startsWith('/') ||
        value.endsWith('/') ||
        value.includes('//') ||
        value.includes('\0') ||
        value.split('/').some((part) => part === '.' || part === '..')))
  )
    throw new Error('Please select a valid Dropbox folder.');
}

// Verifies a folder still exists; an empty path means the connected Dropbox root.
export async function requireDropboxFolder(
  folderPath: string,
): Promise<DropboxFolder> {
  validateDropboxPath(folderPath);
  if (folderPath === '') {
    const client = await createDropboxClient();
    await client.filesListFolder({ path: '', limit: 1 }, { timeout: 30_000 });
    return { path: '', name: 'Dropbox' };
  }
  const client = await createDropboxClient();
  const { result: item } = await client.filesGetMetadata(
    { path: folderPath },
    { timeout: 30_000 },
  );
  if (item['.tag'] !== 'folder' || !item.path_lower)
    throw new Error('The Dropbox destination is not a folder.');
  return { path: item.path_lower, name: item.name };
}

// Lists only immediate child folders and supports opaque Dropbox pagination cursors.
export async function listDropboxFolders(
  folderPath = '',
  cursor?: string,
): Promise<DropboxFolderPage> {
  validateDropboxPath(folderPath);
  if (
    cursor !== undefined &&
    (typeof cursor !== 'string' || !cursor || cursor.length > 16384)
  )
    throw new Error('Invalid Dropbox folder cursor.');
  const folder = await requireDropboxFolder(folderPath);
  const client = await createDropboxClient();
  const { result: page } = cursor
    ? await client.filesListFolderContinue({ cursor }, { timeout: 30_000 })
    : await client.filesListFolder(
        { path: folder.path, recursive: false, limit: 100 },
        { timeout: 30_000 },
      );
  return {
    folder,
    folders: page.entries
      .filter(
        (item) =>
          item['.tag'] === 'folder' && typeof item.path_lower === 'string',
      )
      .map((item) => ({ path: item.path_lower!, name: item.name })),
    cursor: page.has_more ? page.cursor : undefined,
  };
}

// Uses the SDK's bounded file reader, upload sessions, retry handling, and progress reporting.
export async function uploadDropboxFile(
  source: string,
  folderPath: string,
  onProgress: (percent: number) => void = () => {},
): Promise<void> {
  const folder = await requireDropboxFolder(folderPath);
  const client = await createDropboxClient();
  const sourceFile = await fileUpload(source);
  if (sourceFile.size <= 0)
    throw new Error('The upload source must be a nonempty file.');
  await uploadFile(
    client,
    sourceFile,
    {
      path: `${folder.path}/${path.basename(source)}`,
      mode: { '.tag': 'add' },
      autorename: true,
      mute: true,
      strict_conflict: true,
    },
    {
      chunkSize: CHUNK_SIZE,
      parallelUploads: 1,
      timeout: 120_000,
      progress: ({ bytesCommitted, totalBytes }) =>
        onProgress((bytesCommitted / totalBytes) * 100),
    },
  );
}

// Builds a Dropbox web folder link from a validated API path rather than an arbitrary renderer URL.
export function dropboxFolderUrl(folderPath: string): string {
  validateDropboxPath(folderPath);
  return `https://www.dropbox.com/home${folderPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}
