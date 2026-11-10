// Exercises the real Google OAuth library to verify refreshed credentials are shared and invalidated.

import { beforeEach, expect, test, vi } from 'vitest';
import type { Auth, drive_v3 } from 'googleapis';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Buffer>>(),
  decrypt: vi.fn<() => Promise<{ result: string }>>(),
  rm: vi.fn<() => Promise<void>>(),
}));
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/yoink-google-client-test',
  },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    decryptStringAsync: mocks.decrypt,
  },
  shell: {},
}));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.read,
  rm: mocks.rm,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('GOOGLE_CLIENT_ID', 'synthetic-client');
  vi.stubGlobal('GOOGLE_CLIENT_SECRET', 'synthetic-secret');
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.decrypt.mockResolvedValue({
    result: JSON.stringify({
      scope: 'https://www.googleapis.com/auth/drive.file',
      refresh_token: 'synthetic-refresh',
      access_token: 'synthetic-expired',
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
  const { createDriveClient } =
    await import('../src/cloud-storage/google/account');
  const [validation, upload] = await Promise.all([
    createDriveClient(),
    createDriveClient(),
  ]);
  const auth = driveAuth(validation);
  expect(driveAuth(upload)).toBe(auth);
  const requests = vi.fn<() => Promise<object>>().mockResolvedValue({
    data: {
      access_token: 'synthetic-refreshed',
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
