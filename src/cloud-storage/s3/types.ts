// Defines and validates the backend connection used for S3 uploads.

export interface S3Destination {
  // Base URL of the backend that owns AWS credentials and bucket configuration.
  backendUrl: string;
}

// Requires HTTP or HTTPS without embedded credentials, query parameters, or fragments.
export function validateS3Destination(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Configure the backend URL.';
  try {
    const url = new URL((value as S3Destination).backendUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return 'Configure a valid HTTP backend URL.';
    return null;
  } catch {
    return 'Configure a valid HTTP backend URL.';
  }
}
