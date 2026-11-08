// Exercises the real Google OAuth library to verify refreshed credentials are shared and invalidated.

import { beforeEach, expect, test, vi } from 'vitest';
import type { Auth, drive_v3 } from 'googleapis';

const mocks = vi.hoisted(() => ({
  // Reads an encrypted credential blob without accessing personal data.
  read: vi.fn<() => Promise<Buffer>>(),
  // Restores expired synthetic credentials.
  decrypt: vi.fn<() => Promise<{ result: string }>>(),
  // Simulates deletion after a successful disconnect.
  rm: vi.fn<() => Promise<void>>(),
}));
vi.mock('electron', () => ({
  // Keeps the synthetic credential path separate from app data.
  app: {
    // Supplies a test-only user-data location.
    getPath: () => '/tmp/yoink-google-client-test',
  },
  // Simulates the secure storage boundary without mocking OAuth behavior.
  safeStorage: {
    // A usable OS keyring.
    isAsyncEncryptionAvailable: async () => true,
    // A secure Linux storage backend.
    getSelectedStorageBackend: () => 'gnome_libsecret',
    // Returns only synthetic credentials from this test.
    decryptStringAsync: mocks.decrypt,
  },
  // Satisfies the account module import; these tests never start browser authorization.
  shell: {},
}));
vi.mock('node:fs/promises', () => ({
  // Reads only the synthetic token blob.
  readFile: mocks.read,
  // Removes only the synthetic token blob.
  rm: mocks.rm,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('GOOGLE_CLIENT_ID', 'synthetic-client');
  vi.stubGlobal('GOOGLE_CLIENT_SECRET', 'synthetic-secret');
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.decrypt.mockResolvedValue({
    // Google must refresh this credential before authenticated use.
    result: JSON.stringify({
      // Grants access to Picker-selected destinations.
      scope: 'https://www.googleapis.com/auth/drive.file',
      // Offline credential that remains usable.
      refresh_token: 'synthetic-refresh',
      // Access credential that has already expired.
      access_token: 'synthetic-expired',
      // Expired before the test starts.
      expiry_date: 1,
    }),
  });
});

// Reads the library's client context to verify authentication identity without making requests.
function driveAuth(drive: drive_v3.Drive): Auth.OAuth2Client {
  // googleapis exposes the configured auth client through this context field.
  // eslint-disable-next-line no-underscore-dangle
  return drive.context._options.auth as Auth.OAuth2Client;
}

test('concurrent Drive clients share a single refresh rather than restoring expired tokens', async () => {
  const { createDriveClient } = await import('../src/google/account');
  const [validation, upload] = await Promise.all([
    createDriveClient(),
    createDriveClient(),
  ]);
  const auth = driveAuth(validation);
  expect(driveAuth(upload)).toBe(auth);
  const requests = vi.fn<() => Promise<object>>().mockResolvedValue({
    // A synthetic token-endpoint response; no network request is made.
    data: {
      // Fresh credential reusable by subsequent uploads.
      access_token: 'synthetic-refreshed',
      // Keep the new token valid beyond the library's eager refresh window.
      expires_in: 3600,
    },
  });
  auth.transporter.request =
    requests as unknown as typeof auth.transporter.request;
  await Promise.all([
    auth.getAccessToken(),
    driveAuth(upload).getAccessToken(),
  ]);
  const subsequent = await createDriveClient();
  await driveAuth(subsequent).getAccessToken();
  expect(requests).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(auth.credentials.refresh_token).toBe('synthetic-refresh');
  expect(auth.credentials.scope).toBe(
    'https://www.googleapis.com/auth/drive.file',
  );
});
