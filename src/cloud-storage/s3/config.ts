// Resolves the backend connection without loading AWS settings into Electron.

import { validateS3Destination, type S3Destination } from './types';

// Uses a runtime override or the backend URL supplied to the main-process build.
export function configuredS3Destination(): S3Destination {
  const destination = {
    backendUrl: process.env.YOINK_BACKEND_URL ?? YOINK_BACKEND_URL,
  };
  const error = validateS3Destination(destination);
  if (error) throw new Error(error);
  return destination;
}
