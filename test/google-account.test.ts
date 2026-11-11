// Tests OAuth callback validation, encrypted persistence, and credential revocation without Google requests.

import { beforeEach, expect, test, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GoogleAccountStatus } from '../src/cloud-storage/google/types/account-types';
// Reload the module per test to isolate its in-memory client cache and operation lock.
let {
  connectGoogleAccount,
  disconnectGoogleAccount,
  googleAccountStatus,
  selectDriveFolder,
  createDriveClient,
} = await import('../src/cloud-storage/google/account');

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Buffer>>(),
  write: vi.fn<(...args: unknown[]) => Promise<void>>(),
  rename: vi.fn<(...args: unknown[]) => Promise<void>>(),
  rm: vi.fn<(...args: unknown[]) => Promise<void>>(),
  available: vi.fn<() => Promise<boolean>>(),
  encrypt: vi.fn<(text: string) => Promise<Buffer>>(),
  decrypt: vi.fn<(value: Buffer) => Promise<{ result: string }>>(),
  open: vi.fn<(url: string) => Promise<void>>(),
  callback: undefined as
    | undefined
    | ((request: IncomingMessage, response: ServerResponse) => void),
  authUrl:
    vi.fn<(options: { state: string; [key: string]: unknown }) => string>(),
  token:
    vi.fn<
      (
        options: unknown,
      ) => Promise<{ tokens: { refresh_token: string; scope: string } }>
    >(),
  credentials: vi.fn<(tokens: unknown) => void>(),
  revoke: vi.fn<(token: string) => Promise<void>>(),
  about: vi.fn<() => Promise<object>>(),
  folder: vi.fn<(...args: unknown[]) => Promise<{ data: object }>>(),
  savedScope: 'https://www.googleapis.com/auth/drive.file',
  defaults: [] as Array<{
    // Abort signal supplied to OAuth network requests.
    signal?: AbortSignal;
    // Timeout used for short OAuth endpoints.
    timeout?: number;
  }>,
  close: vi.fn<() => void>(),
}));
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/yoink-test',
  },
  safeStorage: {
    isAsyncEncryptionAvailable: mocks.available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: mocks.encrypt,
    decryptStringAsync: mocks.decrypt,
  },
  shell: { /* Browser launch stub. */ openExternal: mocks.open },
}));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.read,
  writeFile: mocks.write,
  rename: mocks.rename,
  rm: mocks.rm,
}));
vi.mock('node:http', () => ({
  createServer: (requestHandler: typeof mocks.callback) => {
    mocks.callback = requestHandler;
    return {
      once: vi.fn<() => void>(),
      listen: (_port: number, _host: string, ready: () => void) => ready(),
      address: () => ({ /* Fake loopback port. */ port: 12345 }),
      close: mocks.close,
      closeAllConnections: vi.fn<() => void>(),
    };
  },
}));
vi.mock('googleapis', () => ({
  Auth: {
    CodeChallengeMethod: {
      S256: 'S256',
    },
  },
  google: {
    drive: () => ({
      files: {
        get: mocks.folder,
      },
      about: {
        get: mocks.about,
      },
    }),
    auth: {
      OAuth2: class {
        // Records each client independently for deadline assertions.
        constructor() {
          mocks.defaults.push(this.transporter.defaults);
        }
        // Exposes restored scope metadata as the real OAuth client does.
        credentials = {
          scope: mocks.savedScope,
          refresh_token: 'saved',
        };
        // Accepts token-refresh metadata listeners as the real library does.
        on = vi.fn<(event: string, callback: unknown) => void>();
        // Captures auth request options.
        generateAuthUrl = mocks.authUrl;
        // Exchanges a validated code.
        getToken = mocks.token;
        // Restores saved tokens just as the real OAuth client does.
        setCredentials(tokens: typeof this.credentials) {
          mocks.credentials(tokens);
          this.credentials = tokens;
        }
        // Provides request defaults used to abort Google network requests.
        transporter = {
          defaults: {} as { signal?: AbortSignal; timeout?: number },
        };
        // Revokes the saved refresh credential directly.
        revokeToken = mocks.revoke;
        // Creates a deterministic PKCE verifier for assertions.
        async generateCodeVerifierAsync() {
          return {
            codeVerifier: 'verifier',
            codeChallenge: 'challenge',
          };
        }
      },
    },
  },
}));

// Delivers a simulated request to the active OAuth callback.
function callback(query: string): number {
  let status = 200;
  const response = {
    writeHead: (code: number) => {
      status = code;
      return response;
    },
    end: vi.fn<() => void>(),
  };
  mocks.callback!(
    {
      method: 'GET',
      url: `/oauth2callback?${query}`,
    } as IncomingMessage,
    response as unknown as ServerResponse,
  );
  return status;
}

beforeEach(async () => {
  vi.resetModules();
  ({
    connectGoogleAccount,
    disconnectGoogleAccount,
    googleAccountStatus,
    selectDriveFolder,
    createDriveClient,
  } = await import('../src/cloud-storage/google/account'));
  vi.resetAllMocks();
  mocks.defaults.length = 0;
  vi.stubGlobal('GOOGLE_CLIENT_ID', 'desktop-client');
  vi.stubGlobal('GOOGLE_CLIENT_SECRET', 'desktop-secret');
  mocks.available.mockResolvedValue(true);
  mocks.about.mockResolvedValue({});
  mocks.savedScope = 'https://www.googleapis.com/auth/drive.file';
  mocks.folder.mockResolvedValue({
    data: {
      id: 'picked-folder',
      name: 'Videos',
      mimeType: 'application/vnd.google-apps.folder',
      capabilities: {
        canAddChildren: true,
      },
    },
  });
  mocks.read.mockRejectedValue(
    Object.assign(new Error('missing'), {
      code: 'ENOENT',
    }),
  );
  mocks.encrypt.mockResolvedValue(Buffer.from('encrypted'));
  mocks.decrypt.mockResolvedValue({
    result: JSON.stringify({
      scope: mocks.savedScope,
      refresh_token: 'saved',
      access_token: 'expired-access',
      expiry_date: 1,
    }),
  });
  mocks.token.mockResolvedValue({
    tokens: {
      refresh_token: 'private-token',
      scope: 'https://www.googleapis.com/auth/drive.file',
    },
  });
  mocks.authUrl.mockReturnValue('https://accounts.google.com/oauth');
});

test('validates state before exchanging a code and stores only encrypted tokens', async () => {
  mocks.open.mockImplementation(async () => {
    expect(callback('state=wrong&code=untrusted')).toBe(400);
    expect(mocks.token).not.toHaveBeenCalled();
    const state = mocks.authUrl.mock.calls[0][0].state;
    expect(callback(`state=${state}&code=valid`)).toBe(200);
  });
  await expect(connectGoogleAccount()).resolves.toEqual({
    connected: true,
  });
  expect(mocks.authUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      code_challenge_method: 'S256',
      scope: ['https://www.googleapis.com/auth/drive.file'],
    }),
  );
  expect(mocks.token).toHaveBeenCalledWith({
    code: 'valid',
    codeVerifier: 'verifier',
  });
  expect(mocks.write).toHaveBeenCalledWith(
    '/tmp/yoink-test/google-account.enc.tmp',
    Buffer.from('encrypted'),
    { /* User-only file permissions. */ mode: 0o600 },
  );
  expect(mocks.close).toHaveBeenCalledOnce();
});

test('does not open a browser when secure storage is unavailable', async () => {
  mocks.available.mockResolvedValue(false);
  expect((await connectGoogleAccount()).error).toBeTruthy();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

test('handles denied consent and closes the callback listener', async () => {
  mocks.open.mockImplementation(async () => {
    const state = mocks.authUrl.mock.calls[0][0].state;
    callback(`state=${state}&error=access_denied`);
  });
  expect((await connectGoogleAccount()).error).toBeTruthy();
  expect(mocks.token).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});

test('returns saved status without exposing tokens and revokes before deleting', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  await expect(googleAccountStatus()).resolves.toEqual({
    connected: true,
    needsReconnect: false,
  });
  await expect(disconnectGoogleAccount()).resolves.toEqual({
    connected: false,
  });
  expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith('saved');
  expect(mocks.rm).toHaveBeenCalledOnce();
});

test('retains credentials if remote revocation fails', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.revoke.mockRejectedValue(new Error('network failure'));
  expect((await disconnectGoogleAccount()).error).toBeTruthy();
  expect(mocks.rm).not.toHaveBeenCalled();
});

test('does not save credentials when Drive API access fails', async () => {
  mocks.open.mockImplementation(async () => {
    const state = mocks.authUrl.mock.calls[0][0].state;
    callback(`state=${state}&code=valid`);
  });
  mocks.about.mockRejectedValue(new Error('Drive API disabled'));
  expect((await connectGoogleAccount()).error).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});

test('does not save a grant without upload permissions', async () => {
  mocks.open.mockImplementation(async () => {
    const state = mocks.authUrl.mock.calls[0][0].state;
    callback(`state=${state}&code=valid`);
  });
  mocks.token.mockResolvedValue({
    tokens: {
      refresh_token: 'private-token',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
    },
  });
  expect((await connectGoogleAccount()).error).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
});

test('opens Google Picker for a single folder and verifies the returned ID', async () => {
  mocks.open.mockImplementation(async (link) => {
    const url = new URL(link);
    expect(url.searchParams.get('trigger_onepick')).toBe('true');
    expect(url.searchParams.get('allow_folder_selection')).toBe('true');
    expect(url.searchParams.get('allow_multiple')).toBe('false');
    expect(url.searchParams.get('mimetypes')).toBe(
      'application/vnd.google-apps.folder',
    );
    const state = mocks.authUrl.mock.calls[0][0].state;
    expect(callback(`state=wrong&code=bad&picked_file_ids=untrusted`)).toBe(
      400,
    );
    expect(mocks.token).not.toHaveBeenCalled();
    callback(`state=${state}&code=valid&picked_file_ids=picked-folder`);
  });
  await expect(selectDriveFolder()).resolves.toEqual({
    id: 'picked-folder',
    name: 'Videos',
  });
  expect(mocks.authUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      include_granted_scopes: false,
      scope: ['https://www.googleapis.com/auth/drive.file'],
    }),
  );
  expect(mocks.folder).toHaveBeenCalledWith(
    expect.objectContaining({
      fileId: 'picked-folder',
    }),
    expect.objectContaining({
      signal: expect.any(AbortSignal),
    }),
  );
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledOnce();
});

test.each(['', '&error=access_denied'])(
  'cancelling Picker preserves the previous destination and credentials (%s)',
  async (error) => {
    mocks.open.mockImplementation(async () => {
      const state = mocks.authUrl.mock.calls[0][0].state;
      callback(`state=${state}&code=valid${error}`);
    });
    await expect(selectDriveFolder()).resolves.toBeNull();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  },
);

test.each(['file-one,file-two', '../invalid'])(
  'rejects invalid or multiple Picker selections (%s)',
  async (ids) => {
    mocks.open.mockImplementation(async () => {
      const state = mocks.authUrl.mock.calls[0][0].state;
      callback(
        `state=${state}&code=valid&picked_file_ids=${encodeURIComponent(ids)}`,
      );
    });
    await expect(selectDriveFolder()).rejects.toThrow('Google Picker');
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  },
);

test('rejects a selected non-folder without replacing saved credentials', async () => {
  mocks.open.mockImplementation(async () => {
    const state = mocks.authUrl.mock.calls[0][0].state;
    callback(`state=${state}&code=valid&picked_file_ids=not-a-folder`);
  });
  mocks.folder.mockResolvedValue({
    data: {
      id: 'not-a-folder',
      name: 'video.mp4',
      mimeType: 'video/mp4',
    },
  });
  await expect(selectDriveFolder()).rejects.toThrow('Google Picker');
  expect(mocks.write).not.toHaveBeenCalled();
});

test('legacy broad grants require reconnecting to per-file Picker access', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.decrypt.mockResolvedValue({
    result: JSON.stringify({
      scope: 'https://www.googleapis.com/auth/drive',
      refresh_token: 'saved',
    }),
  });
  expect((await googleAccountStatus()).needsReconnect).toBe(true);
  await expect(createDriveClient()).rejects.toThrow('Reconnect Google Drive');
});

test('Picker timeout closes its listener without replacing credentials', async () => {
  vi.useFakeTimers();
  try {
    mocks.open.mockResolvedValue(undefined);
    const pending = selectDriveFolder().catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await pending).toBeInstanceOf(Error);
    expect(((await pending) as Error).message).toContain('Google Picker');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

// Creates a controllable network response for concurrency and late-response regressions.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve,
  };
}

test('disconnect locks out sign-in, Picker, and a second disconnect before deleting credentials', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  const revocation = deferred<void>();
  mocks.revoke.mockReturnValueOnce(revocation.promise);
  const pending = disconnectGoogleAccount();
  await vi.waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('saved'));
  expect((await connectGoogleAccount()).error).toBeTruthy();
  await expect(selectDriveFolder()).rejects.toThrow('Google Picker');
  expect((await disconnectGoogleAccount()).error).toBeTruthy();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalled();
  revocation.resolve();
  await expect(pending).resolves.toEqual({
    connected: false,
  });
  expect(mocks.revoke).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledOnce();
  mocks.read.mockRejectedValue(
    Object.assign(new Error('missing'), {
      code: 'ENOENT',
    }),
  );
  expect((await googleAccountStatus()).connected).toBe(false);
});

test('failed disconnect releases its lock and preserves the usable account cache', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.revoke.mockRejectedValueOnce(new Error('offline'));
  expect((await disconnectGoogleAccount()).error).toBeTruthy();
  expect((await googleAccountStatus()).connected).toBe(true);
  expect(mocks.rm).not.toHaveBeenCalled();
  await expect(disconnectGoogleAccount()).resolves.toEqual({
    connected: false,
  });
});

test.each(['token', 'folder', 'about'] as const)(
  'authorization deadline aborts a stalled %s request and ignores late completion',
  async (stage) => {
    vi.useFakeTimers();
    try {
      const tokenResponse = {
        tokens: {
          refresh_token: 'late-refresh',
          scope: 'https://www.googleapis.com/auth/drive.file',
        },
      };
      const tokenDelay = deferred<typeof tokenResponse>();
      const folderDelay = deferred<{ data: object }>();
      const aboutDelay = deferred<object>();
      if (stage === 'token')
        mocks.token.mockReturnValueOnce(tokenDelay.promise);
      if (stage === 'folder')
        mocks.folder.mockReturnValueOnce(folderDelay.promise);
      if (stage === 'about')
        mocks.about.mockReturnValueOnce(aboutDelay.promise);
      mocks.open.mockImplementation(async () => {
        const state = mocks.authUrl.mock.calls.at(-1)![0].state;
        callback(`state=${state}&code=valid&picked_file_ids=picked-folder`);
      });
      const pending =
        stage === 'about'
          ? connectGoogleAccount()
          : selectDriveFolder().catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.token).toHaveBeenCalledOnce();
      const signal = mocks.defaults.find((options) => options.signal)?.signal;
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(stage === 'about' ? 120_000 : 300_000);
      const failure = await pending;
      const error =
        failure instanceof Error
          ? failure.message
          : (failure as GoogleAccountStatus).error;
      expect(error).toBeTruthy();
      expect(signal?.aborted).toBe(true);
      expect(mocks.close).toHaveBeenCalledOnce();
      tokenDelay.resolve(tokenResponse);
      folderDelay.resolve({
        data: {
          id: 'late-folder',
          name: 'Late folder',
          mimeType: 'application/vnd.google-apps.folder',
          capabilities: {
            canAddChildren: true,
          },
        },
      });
      aboutDelay.resolve({});
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.rename).not.toHaveBeenCalled();
      // Cleanup must release the lock so another attempt succeeds immediately.
      await expect(connectGoogleAccount()).resolves.toEqual({
        connected: true,
      });
      expect(mocks.write).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  },
);

test('a successful reconnect replaces the cached account used for subsequent revocation', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  expect((await googleAccountStatus()).connected).toBe(true);
  mocks.open.mockImplementation(async () => {
    const state = mocks.authUrl.mock.calls.at(-1)![0].state;
    callback(`state=${state}&code=valid`);
  });
  expect((await connectGoogleAccount()).connected).toBe(true);
  await disconnectGoogleAccount();
  // The previous account used "saved"; the new grant uses this refresh credential.
  expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith('private-token');
  expect(mocks.read).toHaveBeenCalledOnce();
});
