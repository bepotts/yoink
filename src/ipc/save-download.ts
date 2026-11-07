// Saves completed files without replacing an existing destination.

import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';

export async function saveDownload(
  source: string,
  folder: string,
): Promise<string> {
  const { name, ext, base } = path.parse(source);
  for (let number = 0; ; number++) {
    const destination = path.join(
      folder,
      number === 0 ? base : `${name} (${number})${ext}`,
    );
    try {
      // Exclusive creation also protects against simultaneous downloads.
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}
