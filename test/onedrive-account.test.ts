// Tests Microsoft PKCE callbacks, encrypted cache persistence, cancellation, and serialized disconnects.

import { beforeEach, expect, test, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const mocks = vi.hoisted(() => ({
  authority: vi.fn<(value: string) => void>(),
  read: vi.fn<() => Promise<Buffer>>(),
  write: vi.fn<(...args: unknown[]) => Promise<void>>(),
  rename: vi.fn<(...args: unknown[]) => Promise<void>>(),
  rm: vi.fn<(...args: unknown[]) => Promise<void>>(),
  secure: vi.fn<() => Promise<boolean>>(),
  browser: vi.fn<(url: string) => Promise<void>>(),
  url: vi.fn<
    (options: { state?: string; codeChallenge?: string }) => Promise<string>
  >(),
  token: vi.fn<(...args: unknown[]) => Promise<object>>(),
  silent: vi.fn<(...args: unknown[]) => Promise<object>>(),
  callback: undefined as
    | undefined
    | ((request: IncomingMessage, response: ServerResponse) => void),
  close: vi.fn<() => void>(),
}));
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/yoink-microsoft-tests',
  },
  safeStorage: {
    isAsyncEncryptionAvailable: mocks.secure,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async () => Buffer.from('encrypted-cache'),
    decryptStringAsync: async () => ({
      result: '{"id":"user-1","cache":"saved-cache"}',
    }),
  },
  shell: { /* Browser handoff. */ openExternal: mocks.browser },
}));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.read,
  writeFile: mocks.write,
  rename: mocks.rename,
  rm: mocks.rm,
}));
vi.mock('node:http', () => ({
  createServer: (handler: typeof mocks.callback) => {
    mocks.callback = handler;
    return {
      once: vi.fn<(event: string, callback: unknown) => void>(),
      listen: (_port: number, _host: string, ready: () => void) => ready(),
      address: () => ({ /* Loopback port. */ port: 12345 }),
      close: mocks.close,
      closeAllConnections: () => {},
    };
  },
}));
vi.mock('@azure/msal-node', () => ({
  PublicClientApplication: class {
    // Captures public authority configuration without making network requests.
    constructor(options: {
      /* MSAL's public authentication configuration. */ auth: {
        /* Validated Microsoft sign-in authority. */ authority: string;
      };
    }) {
      mocks.authority(options.auth.authority);
    }
    // Captures auth code request parameters.
    getAuthCodeUrl = mocks.url;
    // Redeems a state-validated code.
    acquireTokenByCode = mocks.token;
    // Provides a silently refreshed access token.
    acquireTokenSilent = mocks.silent;
    // Supplies only the cache methods used by the main process.
    getTokenCache() {
      return {
        serialize: () => 'synthetic-msal-cache',
        deserialize: () => {},
        getAccountByHomeId: async () => ({
          homeAccountId: 'user-1',
        }),
      };
    }
  },
}));

// Delivers a browser callback and records its HTTP status.
function callback(state: string, query: string) {
  let status = 200;
  const response = {
    writeHead: (code: number) => {
      status = code;
      return response;
    },
    end: () => {},
  };
  mocks.callback!(
    {
      method: 'GET',
      url: `/callback?state=${state}&${query}`,
    } as IncomingMessage,
    response as unknown as ServerResponse,
  );
  return status;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('MICROSOFT_CLIENT_ID', 'synthetic-client');
  vi.stubGlobal('MICROSOFT_TENANT_ID', 'common');
  mocks.secure.mockResolvedValue(true);
  mocks.read.mockRejectedValue(new Error('missing cache'));
  mocks.url.mockResolvedValue('https://login.microsoftonline.com/authorize');
  mocks.token.mockResolvedValue({
    account: {
      homeAccountId: 'user-1',
    },
  });
  mocks.silent.mockResolvedValue({
    accessToken: 'synthetic-access',
  });
});

test('validates state and saves only encrypted MSAL credentials', async () => {
  const { connectOneDrive } = await import('../src/onedrive/account');
  mocks.browser.mockImplementation(async () => {
    expect(callback('wrong', 'code=bad')).toBe(400);
    expect(mocks.token).not.toHaveBeenCalled();
    callback(mocks.url.mock.calls[0][0].state!, 'code=valid');
  });
  expect(await connectOneDrive()).toEqual({
    connected: true,
  });
  expect(mocks.url.mock.calls[0][0].codeChallenge).toBeTruthy();
  expect(mocks.write).toHaveBeenCalledWith(
    '/tmp/yoink-microsoft-tests/onedrive-account.enc.tmp',
    Buffer.from('encrypted-cache'),
    { /* Current user only. */ mode: 0o600 },
  );
  expect(mocks.close).toHaveBeenCalledOnce();
});

test('cancelled sign-in keeps the previous Microsoft account', async () => {
  const { oneDriveStatus, connectOneDrive } =
    await import('../src/onedrive/account');
  mocks.read.mockResolvedValue(Buffer.from('saved-encrypted'));
  expect((await oneDriveStatus()).connected).toBe(true);
  mocks.browser.mockImplementation(async () => {
    callback(mocks.url.mock.calls[0][0].state!, 'error=access_denied');
  });
  const result = await connectOneDrive();
  expect(result.connected).toBe(true);
  expect(result.error).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
});

test('requires OS encryption before opening Microsoft sign-in', async () => {
  const { connectOneDrive } = await import('../src/onedrive/account');
  mocks.secure.mockResolvedValue(false);
  expect((await connectOneDrive()).error).toBeTruthy();
  expect(mocks.browser).not.toHaveBeenCalled();
});

test('serializes refresh persistence before disconnect so stale credentials cannot be recreated', async () => {
  const { oneDriveAccessToken, disconnectOneDrive, oneDriveStatus } =
    await import('../src/onedrive/account');
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  let finish!: (value: object) => void;
  mocks.silent.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const refresh = oneDriveAccessToken();
  await vi.waitFor(() => expect(mocks.silent).toHaveBeenCalledOnce());
  const disconnect = disconnectOneDrive();
  expect(mocks.rm).not.toHaveBeenCalled();
  finish({
    accessToken: 'synthetic-access',
  });
  await refresh;
  expect(await disconnect).toEqual({
    connected: false,
  });
  mocks.read.mockRejectedValue(new Error('cache removed'));
  expect((await oneDriveStatus()).connected).toBe(false);
  expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.rm.mock.invocationCallOrder[0],
  );
});

test('Microsoft authorization timeout ignores a late code exchange and releases the account queue', async () => {
  vi.useFakeTimers();
  try {
    const { connectOneDrive, oneDriveStatus } =
      await import('../src/onedrive/account');
    let finish!: (value: object) => void;
    mocks.token.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.browser.mockImplementation(async () => {
      callback(mocks.url.mock.calls[0][0].state!, 'code=valid');
    });
    const pending = connectOneDrive();
    await vi.advanceTimersByTimeAsync(300_000);
    expect((await pending).error).toBeTruthy();
    expect(mocks.close).toHaveBeenCalledOnce();
    finish({
      account: {
        homeAccountId: 'late-user',
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.write).not.toHaveBeenCalled();
    expect((await oneDriveStatus()).connected).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('personal-only registrations use the consumers authority for Microsoft sign-in', async () => {
  vi.stubGlobal('MICROSOFT_TENANT_ID', 'consumers');
  const { connectOneDrive } = await import('../src/onedrive/account');
  mocks.browser.mockImplementation(async () => {
    callback(mocks.url.mock.calls[0][0].state!, 'code=valid');
  });
  expect((await connectOneDrive()).connected).toBe(true);
  expect(mocks.authority).toHaveBeenCalledWith(
    'https://login.microsoftonline.com/consumers',
  );
  expect(mocks.authority).not.toHaveBeenCalledWith(
    'https://login.microsoftonline.com/common',
  );
});

test('rejects arbitrary authority URLs before opening the browser', async () => {
  vi.stubGlobal('MICROSOFT_TENANT_ID', 'https://attacker.example');
  const { connectOneDrive } = await import('../src/onedrive/account');
  expect((await connectOneDrive()).error).toBeTruthy();
  expect(mocks.browser).not.toHaveBeenCalled();
});
