// Tests OAuth callback validation, encrypted persistence, and credential revocation without Google requests.

import { beforeEach, expect, test, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GoogleAccountStatus } from '../src/google/types/account-types';
// Reload the module per test to isolate its in-memory client cache and operation lock.
let {
  connectGoogleAccount,
  disconnectGoogleAccount,
  googleAccountStatus,
  selectDriveFolder,
  createDriveClient,
} = await import('../src/google/account');

const mocks = vi.hoisted(() => ({
  // Fake disk storage operations.
  read: vi.fn<() => Promise<Buffer>>(),
  // Captures encrypted token writes.
  write: vi.fn<(...args: unknown[]) => Promise<void>>(),
  // Captures atomic credential replacement.
  rename: vi.fn<(...args: unknown[]) => Promise<void>>(),
  // Captures credential deletion.
  rm: vi.fn<(...args: unknown[]) => Promise<void>>(),
  // Simulates keyring availability.
  available: vi.fn<() => Promise<boolean>>(),
  // Simulates encryption.
  encrypt: vi.fn<(text: string) => Promise<Buffer>>(),
  // Simulates decryption.
  decrypt: vi.fn<(value: Buffer) => Promise<{ result: string }>>(),
  // Captures browser launches.
  open: vi.fn<(url: string) => Promise<void>>(),
  // Captures callback request handler.
  callback: undefined as
    | undefined
    | ((request: IncomingMessage, response: ServerResponse) => void),
  // Captures authorization options.
  authUrl:
    vi.fn<(options: { state: string; [key: string]: unknown }) => string>(),
  // Simulates the token exchange.
  token:
    vi.fn<
      (
        options: unknown,
      ) => Promise<{ tokens: { refresh_token: string; scope: string } }>
    >(),
  // Restores credentials on the OAuth client.
  credentials: vi.fn<(tokens: unknown) => void>(),
  // Simulates remote revocation.
  revoke: vi.fn<(token: string) => Promise<void>>(),
  // Verifies the granted account can call the Drive API.
  about: vi.fn<() => Promise<object>>(),
  // Verifies Picker-selected destination metadata.
  folder: vi.fn<(...args: unknown[]) => Promise<{ data: object }>>(),
  // Controls the saved grant for migration tests.
  savedScope: 'https://www.googleapis.com/auth/drive.file',
  // Tracks per-client request options for cancellation assertions.
  defaults: [] as Array<{
    // Abort signal supplied to OAuth network requests.
    signal?: AbortSignal;
    // Timeout used for short OAuth endpoints.
    timeout?: number;
  }>,
  // Captures listener cleanup.
  close: vi.fn<() => void>(),
}));
vi.mock('electron', () => ({
  // Supplies a stable credential location.
  app: {
    /* Isolated fake user-data directory. */ getPath: () => '/tmp/yoink-test',
  },
  // Provides the OS encryption boundary.
  safeStorage: {
    // Controls secure storage availability.
    isAsyncEncryptionAvailable: mocks.available,
    // Simulates a secure Linux backend.
    getSelectedStorageBackend: () => 'gnome_libsecret',
    // Encrypts before disk persistence.
    encryptStringAsync: mocks.encrypt,
    // Decrypts saved credentials.
    decryptStringAsync: mocks.decrypt,
  },
  // Opens the authorization URL.
  shell: { /* Browser launch stub. */ openExternal: mocks.open },
}));
vi.mock('node:fs/promises', () => ({
  // Reads encrypted tokens.
  readFile: mocks.read,
  // Writes encrypted tokens.
  writeFile: mocks.write,
  // Atomically replaces tokens.
  rename: mocks.rename,
  // Removes revoked credentials.
  rm: mocks.rm,
}));
vi.mock('node:http', () => ({
  // Simulates a loopback listener without binding a real port.
  createServer: (requestHandler: typeof mocks.callback) => {
    mocks.callback = requestHandler;
    return {
      // Registers listener error handling.
      once: vi.fn<() => void>(),
      // Immediately completes the loopback bind.
      listen: (_port: number, _host: string, ready: () => void) => ready(),
      // Supplies the assigned callback port.
      address: () => ({ /* Fake loopback port. */ port: 12345 }),
      // Stops accepting connections.
      close: mocks.close,
      // Closes outstanding connections.
      closeAllConnections: vi.fn<() => void>(),
    };
  },
}));
vi.mock('googleapis', () => ({
  // Mirrors the library's PKCE enum.
  Auth: {
    /* Supported challenge algorithms. */ CodeChallengeMethod: {
      /* SHA-256. */ S256: 'S256',
    },
  },
  // Exposes only the OAuth client used by the account service.
  google: {
    // Provides a minimal Drive API capability probe.
    drive: () => ({
      // Fetches the folder selected by Google's Picker.
      files: {
        // Validates type and upload permission before persisting a grant.
        get: mocks.folder,
      },
      // Drive account metadata endpoint.
      about: {
        // Checks authenticated API access without listing user files.
        get: mocks.about,
      },
    }),
    // OAuth constructors.
    auth: {
      // Fake installed-application client.
      OAuth2: class {
        // Records each client independently for deadline assertions.
        constructor() {
          mocks.defaults.push(this.transporter.defaults);
        }
        // Exposes restored scope metadata as the real OAuth client does.
        credentials = {
          /* Granted upload and folder browsing scope. */ scope:
            mocks.savedScope,
          // Offline credential used even if the access token is expired.
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
          // Per-authorization cancellation signal and endpoint timeout.
          defaults: {} as { signal?: AbortSignal; timeout?: number },
        };
        // Revokes the saved refresh credential directly.
        revokeToken = mocks.revoke;
        // Creates a deterministic PKCE verifier for assertions.
        async generateCodeVerifierAsync() {
          return {
            // Private verifier used at exchange time.
            codeVerifier: 'verifier',
            // Public challenge sent to Google.
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
    // Captures callback rejection status.
    writeHead: (code: number) => {
      status = code;
      return response;
    },
    // Completes the simulated response.
    end: vi.fn<() => void>(),
  };
  mocks.callback!(
    {
      // Simulates a normal browser redirect.
      method: 'GET',
      // Uses the expected callback route.
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
  } = await import('../src/google/account'));
  vi.resetAllMocks();
  mocks.defaults.length = 0;
  vi.stubGlobal('GOOGLE_CLIENT_ID', 'desktop-client');
  vi.stubGlobal('GOOGLE_CLIENT_SECRET', 'desktop-secret');
  mocks.available.mockResolvedValue(true);
  mocks.about.mockResolvedValue({});
  mocks.savedScope = 'https://www.googleapis.com/auth/drive.file';
  mocks.folder.mockResolvedValue({
    // A verified writable destination selected in the browser.
    data: {
      // Real Drive ID returned from the API.
      id: 'picked-folder',
      // Human-readable destination.
      name: 'Videos',
      // Folder-only selection is enforced again in the main process.
      mimeType: 'application/vnd.google-apps.folder',
      // Upload permission must be present.
      capabilities: {
        // Can add uploaded files here.
        canAddChildren: true,
      },
    },
  });
  mocks.read.mockRejectedValue(
    Object.assign(new Error('missing'), {
      /* Missing saved account. */ code: 'ENOENT',
    }),
  );
  mocks.encrypt.mockResolvedValue(Buffer.from('encrypted'));
  mocks.decrypt.mockResolvedValue({
    /* Saved credentials decrypted only in main. */ result: JSON.stringify({
      // Persisted grant used by the restored OAuth client.
      scope: mocks.savedScope,
      // A saved offline credential.
      refresh_token: 'saved',
      // An expired token must never be used for disconnect.
      access_token: 'expired-access',
      // Expired before this test starts.
      expiry_date: 1,
    }),
  });
  mocks.token.mockResolvedValue({
    /* Google-issued tokens. */ tokens: {
      /* Offline access credential. */ refresh_token: 'private-token',
      // Upload and folder browsing grant returned by Google.
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
    /* Connection succeeded. */ connected: true,
  });
  expect(mocks.authUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      // Enforces PKCE.
      code_challenge_method: 'S256',
      // Requests access only to Picker-selected files.
      scope: ['https://www.googleapis.com/auth/drive.file'],
    }),
  );
  expect(mocks.token).toHaveBeenCalledWith({
    /* Validated code. */ code: 'valid',
    /* Original PKCE verifier. */ codeVerifier: 'verifier',
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
    /* Safe status only. */ connected: true,
    // Current upload scope is already granted.
    needsReconnect: false,
  });
  await expect(disconnectGoogleAccount()).resolves.toEqual({
    /* Account removed. */ connected: false,
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
    // Consent response without the requested upload permission.
    tokens: {
      // Refresh credential must not be saved for an insufficient grant.
      refresh_token: 'private-token',
      // Old read-only authorization cannot upload.
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
    // Verified ID rather than a renderer-supplied path.
    id: 'picked-folder',
    // Verified name returned from the API.
    name: 'Videos',
  });
  expect(mocks.authUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      // Desktop Picker must not combine scopes from the legacy grant.
      include_granted_scopes: false,
      // Use the sole scope supported by Google's native Picker flow.
      scope: ['https://www.googleapis.com/auth/drive.file'],
    }),
  );
  expect(mocks.folder).toHaveBeenCalledWith(
    expect.objectContaining({
      // Verify the folder selected by Google before saving tokens.
      fileId: 'picked-folder',
    }),
    expect.objectContaining({
      // Metadata requests share the authorization deadline.
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
    // The returned ID must resolve to a folder regardless of Picker filtering.
    data: {
      // A file ID cannot be used as an upload destination.
      id: 'not-a-folder',
      // An ordinary video file.
      name: 'video.mp4',
      // Unsupported destination type.
      mimeType: 'video/mp4',
    },
  });
  await expect(selectDriveFolder()).rejects.toThrow('Google Picker');
  expect(mocks.write).not.toHaveBeenCalled();
});

test('legacy broad grants require reconnecting to per-file Picker access', async () => {
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.decrypt.mockResolvedValue({
    // A legacy broad grant must still require reconnecting.
    result: JSON.stringify({
      // Old scope lacking Picker-specific access.
      scope: 'https://www.googleapis.com/auth/drive',
      // Offline credential retained during migration.
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
    // Response that remains pending until the test releases it.
    promise,
    // Completes the synthetic request after checking the concurrent behavior.
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
    // The lock holder completed the only revocation and deletion.
    connected: false,
  });
  expect(mocks.revoke).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledOnce();
  mocks.read.mockRejectedValue(
    Object.assign(new Error('missing'), {
      // Subsequent status must reload instead of returning the cached account.
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
    // A retry must be permitted after the failure.
    connected: false,
  });
});

test.each(['token', 'folder', 'about'] as const)(
  'authorization deadline aborts a stalled %s request and ignores late completion',
  async (stage) => {
    vi.useFakeTimers();
    try {
      const tokenResponse = {
        // Synthetic credentials must never be committed by a late request.
        tokens: {
          // Offline credential used only by this test.
          refresh_token: 'late-refresh',
          // Requested Picker grant.
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
        // Even a valid folder arriving late cannot authorize persistence.
        data: {
          // Destination ID.
          id: 'late-folder',
          // Destination name.
          name: 'Late folder',
          // A genuine folder type.
          mimeType: 'application/vnd.google-apps.folder',
          // Writable destination.
          capabilities: {
            // Uploading would normally be allowed.
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
        // New authorization succeeds after the timed-out one.
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
