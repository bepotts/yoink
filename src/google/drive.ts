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
    // Resolve root aliases or the selected folder.
    fileId: id,
    // Verify it is a writable, untrashed folder.
    fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)',
    // Accept destinations in shared drives.
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
    // Canonical folder ID, including when the caller supplied root.
    id: data.id,
    // Friendly fallback for an unnamed root.
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
        // Create a separate Drive file under the destination.
        requestBody: {
          // Preserve the original filename.
          name: path.basename(source),
          // Upload into the chosen folder rather than the account root.
          parents: [folder.id],
        },
        // Stream bytes without loading videos into memory.
        media: {
          // Let Drive infer the final file type from its name/content.
          mimeType: 'application/octet-stream',
          // Read only the main-process-approved source file.
          body: stream,
        },
        // Request only the creation acknowledgment.
        fields: 'id',
        // Permit uploads to writable shared-drive folders.
        supportsAllDrives: true,
      },
      {
        // Avoid duplicating files by automatically retrying a partially completed create.
        retry: false,
      },
    );
  } finally {
    stream.destroy();
  }
}
