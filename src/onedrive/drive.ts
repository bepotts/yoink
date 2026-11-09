// Browses the user's OneDrive hierarchy and uploads videos through bounded upload-session chunks.

import { open } from 'node:fs/promises';
import path from 'node:path';
import { oneDriveAccessToken } from './account';
import type { GraphItem } from './types/graph-types';
import type {
  OneDriveFolder,
  OneDriveFolderPage,
} from './types/onedrive-types';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
const CHUNK_SIZE = 10 * 320 * 1024;

// Validates item IDs before placing them into Graph paths.
export function validateOneDriveId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9!_-]{1,256}$/.test(id))
    throw new Error('Please select a valid OneDrive folder.');
}

// Rejects untrusted pagination URLs before attaching a Graph access token.
function graphUrl(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.origin !== 'https://graph.microsoft.com' ||
    !parsed.pathname.startsWith('/v1.0/me/drive/') ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Invalid OneDrive request.');
  return parsed.href;
}

// Sends authenticated Graph requests without exposing credentials or provider payloads to the renderer.
async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  const destination = graphUrl(url);
  const token = await oneDriveAccessToken();
  const response = await fetch(destination, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      'OneDrive request failed. Reconnect Microsoft and check folder permissions and storage.',
    );
  return (await response.json()) as T;
}

// Resolves root or a chosen item and rejects files as upload destinations.
export async function requireOneDriveFolder(
  id: string,
): Promise<OneDriveFolder> {
  validateOneDriveId(id);
  const item = await graph<GraphItem>(
    `${GRAPH}/${id === 'root' ? 'root' : `items/${encodeURIComponent(id)}`}?$select=id,name,folder,deleted`,
  );
  if (!item.id || !item.folder || item.deleted)
    throw new Error('The OneDrive folder is unavailable.');
  return {
    id: item.id,
    name: item.name ?? 'My files',
  };
}

// Resolves a provider-supplied browser link for either personal or organizational OneDrive.
export async function oneDriveFolderUrl(id: string): Promise<string> {
  validateOneDriveId(id);
  const item = await graph<{
    // Microsoft-provided browser destination, never accepted directly from the renderer.
    webUrl?: string;
  }>(`${GRAPH}/items/${encodeURIComponent(id)}?$select=webUrl`);
  const url = new URL(item.webUrl ?? '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(
      url.hostname === 'onedrive.live.com' ||
      url.hostname === '1drv.ms' ||
      url.hostname.endsWith('.sharepoint.com')
    )
  )
    throw new Error('Invalid OneDrive browser link.');
  return url.href;
}

// Lists only immediate child folders, starting at My files rather than a flat account-wide list.
export async function listOneDriveFolders(
  id = 'root',
  nextPage?: string,
): Promise<OneDriveFolderPage> {
  validateOneDriveId(id);
  if (nextPage !== undefined && typeof nextPage !== 'string')
    throw new Error('Invalid OneDrive pagination.');
  const folder = await requireOneDriveFolder(id);
  const result = await graph<{
    // Direct children returned by Graph.
    value?: GraphItem[];
    // Continuation URL when more children are available.
    '@odata.nextLink'?: string;
  }>(
    nextPage
      ? graphUrl(nextPage)
      : `${GRAPH}/items/${encodeURIComponent(folder.id)}/children?$select=id,name,folder,deleted&$top=100&$orderby=name`,
  );
  return {
    folder,
    folders: (result.value ?? [])
      .filter((item) => item.folder && !item.deleted && item.id && item.name)
      .map((item) => ({
        id: item.id!,
        name: item.name!,
      })),
    nextPage: result['@odata.nextLink']
      ? graphUrl(result['@odata.nextLink'])
      : undefined,
  };
}

// Uploads a new file in sequential 320-KiB-aligned chunks without overwriting existing names.
export async function uploadOneDriveFile(
  source: string,
  folderId: string,
  onProgress: (percent: number) => void = () => {},
): Promise<void> {
  const folder = await requireOneDriveFolder(folderId);
  const file = await open(source, 'r');
  let sessionUrl: string | undefined;
  let complete = false;
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0)
      throw new Error('The upload source must be a nonempty file.');
    const session = await graph<{
      // Preauthenticated upload URL supplied directly by Microsoft Graph.
      uploadUrl?: string;
    }>(
      `${GRAPH}/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(path.basename(source))}:/createUploadSession`,
      {
        method: 'POST',
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename',
            name: path.basename(source),
          },
        }),
      },
    );
    if (!session.uploadUrl || new URL(session.uploadUrl).protocol !== 'https:')
      throw new Error('Invalid OneDrive upload session.');
    sessionUrl = session.uploadUrl;
    const buffer = Buffer.alloc(CHUNK_SIZE);
    for (let offset = 0; offset < metadata.size; ) {
      const length = Math.min(CHUNK_SIZE, metadata.size - offset);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      if (bytesRead !== length)
        throw new Error('The local file changed during upload.');
      const response = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(bytesRead),
          'Content-Range': `bytes ${offset}-${offset + bytesRead - 1}/${metadata.size}`,
        },
        body: new Uint8Array(buffer.subarray(0, bytesRead)),
        signal: AbortSignal.timeout(120_000),
        redirect: 'error',
      });
      offset += bytesRead;
      const final = offset === metadata.size;
      if (
        final ? ![200, 201].includes(response.status) : response.status !== 202
      )
        throw new Error('OneDrive upload did not complete.');
      // Consume response bodies so chunk uploads release their network resources.
      await response.arrayBuffer();
      onProgress((offset / metadata.size) * 100);
    }
    complete = true;
  } finally {
    await file.close();
    if (sessionUrl && !complete) {
      // Best-effort cleanup of an incomplete upload session; local recovery remains available.
      await fetch(sessionUrl, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      })
        .then((response) => response.arrayBuffer())
        .catch(() => {});
    }
  }
}
