// Tests Dropbox PKCE callbacks, encrypted refresh credentials, cancellation, and authorization deadlines.

import { beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Buffer>>(),
  write: vi.fn<(...args: unknown[]) => Promise<void>>(),
  rename: vi.fn<(...args: unknown[]) => Promise<void>>(),
  rm: vi.fn<(...args: unknown[]) => Promise<void>>(),
  secure: vi.fn<() => Promise<boolean>>(),
  browser: vi.fn<(url: string) => Promise<void>>(),
  decrypt: vi.fn<() => Promise<{ result: string }>>(),
  fetch: vi.fn<typeof fetch>(),
  callback: undefined as
    | undefined
    | ((request: IncomingMessage, response: ServerResponse) => void),
  close: vi.fn<() => void>(),
  listen: vi.fn<(port: number, host: string) => void>(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/yoink-dropbox-tests' },
  safeStorage: {
    isAsyncEncryptionAvailable: mocks.secure,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async () => Buffer.from('encrypted-dropbox-cache'),
    decryptStringAsync: mocks.decrypt,
  },
  shell: { openExternal: mocks.browser },
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
      listen: (port: number, host: string, ready: () => void) => {
        mocks.listen(port, host);
        ready();
      },
      close: mocks.close,
      closeAllConnections: () => {},
    };
  },
}));

// Delivers a synthetic browser callback to the state-validation boundary.
function callback(state: string, query: string): number {
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
      url: `/dropbox-callback?state=${state}&${query}`,
    } as IncomingMessage,
    response as unknown as ServerResponse,
  );
  return status;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('DROPBOX_APP_KEY', 'synthetic-app-key');
  vi.stubGlobal(
    'DROPBOX_REDIRECT_URI',
    'http://127.0.0.1:53683/dropbox-callback',
  );
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.secure.mockResolvedValue(true);
  mocks.read.mockRejectedValue(new Error('no saved account'));
  mocks.decrypt.mockResolvedValue({
    result: JSON.stringify({
      accessToken: 'expired-access',
      refreshToken: 'offline-refresh',
      expiresAt: 1,
    }),
  });
});

test('validates callback state and requests offline access with PKCE at the exact registered redirect', async () => {
  const { connectDropbox } =
    await import('../src/cloud-storage/dropbox/account');
  mocks.browser.mockImplementation(async (link) => {
    const url = new URL(link);
    expect(url.origin).toBe('https://dropbox.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:53683/dropbox-callback',
    );
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(callback('wrong', 'code=bad')).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
    callback(url.searchParams.get('state')!, 'code=valid');
  });
  mocks.fetch.mockResolvedValueOnce(
    Response.json({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 14400,
    }),
  );
  expect(await connectDropbox()).toEqual({ connected: true });
  expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(53683, '127.0.0.1');
  expect(mocks.write).toHaveBeenCalledWith(
    '/tmp/yoink-dropbox-tests/dropbox-account.enc.tmp',
    Buffer.from('encrypted-dropbox-cache'),
    { mode: 0o600 },
  );
  const body = new URL(String(mocks.fetch.mock.calls[0][0])).searchParams;
  expect(body.get('code_verifier')).toBeTruthy();
  const authorization = new URL(mocks.browser.mock.calls[0][0]);
  expect(
    createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),
  ).toBe(authorization.searchParams.get('code_challenge'));
  expect(body.has('client_secret')).toBe(false);
  expect(mocks.close).toHaveBeenCalledOnce();
});

test('cancellation preserves an earlier Dropbox account and folder authorization', async () => {
  const { dropboxStatus, connectDropbox } =
    await import('../src/cloud-storage/dropbox/account');
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  expect((await dropboxStatus()).connected).toBe(true);
  mocks.browser.mockImplementation(async (link) => {
    callback(new URL(link).searchParams.get('state')!, 'error=access_denied');
  });
  const result = await connectDropbox();
  expect(result.connected).toBe(true);
  expect(result.error).toBeTruthy();
  expect(mocks.write).not.toHaveBeenCalled();
});

test('refreshes an expired credential once and retains the refresh token', async () => {
  const { dropboxAccessToken } =
    await import('../src/cloud-storage/dropbox/account');
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.fetch.mockResolvedValueOnce(
    Response.json({ access_token: 'fresh-access', expires_in: 14400 }),
  );
  expect(
    await Promise.all([dropboxAccessToken(), dropboxAccessToken()]),
  ).toEqual(['fresh-access', 'fresh-access']);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(
    new URL(String(mocks.fetch.mock.calls[0][0])).searchParams.get(
      'refresh_token',
    ),
  ).toBe('offline-refresh');
});

test('refreshes before revocation and keeps credentials when revocation fails', async () => {
  const { disconnectDropbox, dropboxStatus } =
    await import('../src/cloud-storage/dropbox/account');
  mocks.read.mockResolvedValue(Buffer.from('encrypted'));
  mocks.fetch
    .mockResolvedValueOnce(
      Response.json({ access_token: 'fresh-access', expires_in: 14400 }),
    )
    .mockResolvedValueOnce(new Response('', { status: 500 }));
  expect((await disconnectDropbox()).error).toBeTruthy();
  expect(
    new Headers(mocks.fetch.mock.calls[1][1]?.headers).get('Authorization'),
  ).toBe('Bearer fresh-access');
  expect(mocks.rm).not.toHaveBeenCalled();
  expect((await dropboxStatus()).connected).toBe(true);
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
  expect(await disconnectDropbox()).toEqual({ connected: false });
  expect(mocks.rm).toHaveBeenCalledOnce();
});

test('does not open a browser without secure credential storage', async () => {
  const { connectDropbox } =
    await import('../src/cloud-storage/dropbox/account');
  mocks.secure.mockResolvedValue(false);
  expect((await connectDropbox()).error).toBeTruthy();
  expect(mocks.browser).not.toHaveBeenCalled();
});

test('authorization timeout closes its callback and ignores a late token exchange', async () => {
  vi.useFakeTimers();
  try {
    const { connectDropbox, dropboxStatus } =
      await import('../src/cloud-storage/dropbox/account');
    let finish!: (response: Response) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.browser.mockImplementation(async (link) => {
      callback(new URL(link).searchParams.get('state')!, 'code=valid');
    });
    const pending = connectDropbox();
    await vi.advanceTimersByTimeAsync(300_000);
    expect((await pending).error).toBeTruthy();
    finish(
      Response.json({
        access_token: 'late',
        refresh_token: 'late-refresh',
        expires_in: 14400,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect((await dropboxStatus()).connected).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('the SDK client uses refreshed credentials when an upload outlives its access token', async () => {
  vi.useFakeTimers();
  try {
    const { createDropboxClient } =
      await import('../src/cloud-storage/dropbox/account');
    mocks.read.mockResolvedValue(Buffer.from('encrypted'));
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({ access_token: 'first-access', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        Response.json({ entries: [], cursor: 'first', has_more: false }),
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: 'second-access', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        Response.json({ entries: [], cursor: 'second', has_more: false }),
      );
    const client = await createDropboxClient();
    await client.filesListFolder({ path: '' });
    vi.setSystemTime(Date.now() + 3_600_000);
    await client.filesListFolder({ path: '' });
    expect(
      new Headers(mocks.fetch.mock.calls[1][1]?.headers).get('Authorization'),
    ).toBe('Bearer first-access');
    expect(
      new Headers(mocks.fetch.mock.calls[3][1]?.headers).get('Authorization'),
    ).toBe('Bearer second-access');
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(mocks.fetch.mock.calls[2][0])).searchParams.get(
        'refresh_token',
      ),
    ).toBe('offline-refresh');
  } finally {
    vi.useRealTimers();
  }
});
