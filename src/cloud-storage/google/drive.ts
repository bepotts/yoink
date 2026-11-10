// Validates Drive folder destinations and streams local files into them.

import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createDriveClient } from './account';
import type { DriveFolder } from './types/drive-types';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Rejects malformed folder IDs before constructing queries or opening Drive URLs.
export function validateDriveFolderId(id: unknown): asserts id is string {
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    id.length > 256
  ) {
    throw new Error('Please select a valid Google Drive folder.');
  }
}

// Revalidates folder existence and permissions immediately before an upload.
export async function requireDriveFolder(id: string): Promise<DriveFolder> {
  validateDriveFolderId(id);
  const drive = await createDriveClient();
  const { data } = await drive.files.get({
    fileId: id,
    fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)',
    supportsAllDrives: true,
  });
  if (
    data.mimeType !== FOLDER_MIME ||
    data.trashed ||
    !data.capabilities?.canAddChildren ||
    !data.id
  ) {
    throw new Error(
      'The selected Google Drive folder is unavailable or does not allow uploads.',
    );
  }
  return {
    id: data.id,
    name: data.name ?? 'My Drive',
  };
}

// Uploads a new file without overwriting existing Drive files of the same name.
export async function uploadDriveFile(
  source: string,
  folderId: string,
): Promise<void> {
  const folder = await requireDriveFolder(folderId);
  const drive = await createDriveClient();
  const stream = createReadStream(source);
  try {
    await drive.files.create(
      {
        requestBody: {
          name: path.basename(source),
          parents: [folder.id],
        },
        media: {
          mimeType: 'application/octet-stream',
          body: stream,
        },
        fields: 'id',
        supportsAllDrives: true,
      },
      {
        retry: false,
      },
    );
  } finally {
    stream.destroy();
  }
}
