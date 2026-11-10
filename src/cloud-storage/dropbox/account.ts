// Connects Dropbox with browser OAuth and PKCE, refreshes tokens, and encrypts credentials with OS storage.

import { app, safeStorage, shell } from 'electron';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Dropbox, DropboxAuth } from 'dropbox';
import { dropboxFetch } from './transport';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  DropboxStatus,
  DropboxTokens,
  DropboxTokenResponse,
} from './types/dropbox-types';

let tokens: DropboxTokens | undefined;
let queue: Promise<unknown> = Promise.resolve();

// Serializes refresh, sign-in, and disconnect so a late request cannot recreate a removed account.
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const pending = queue.then(operation);
  queue = pending.catch(() => {});
  return pending;
}

// Releases a stalled authorization when its deadline expires and ignores late results.
async function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let cancel!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new Error('Dropbox authorization timed out.'));
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

// Stores Dropbox credentials separately from the other providers.
function tokenPath(): string {
  return path.join(app.getPath('userData'), 'dropbox-account.enc');
}

// Refuses plaintext fallback when the operating system keyring is unavailable.
async function secureStorage(): Promise<void> {
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('Enable the OS keyring to connect Dropbox.');
}

// Loads a validated encrypted credential record once per app session.
async function loadTokens(): Promise<DropboxTokens> {
  if (tokens) return tokens;
  await secureStorage();
  const decrypted = await safeStorage.decryptStringAsync(
    await readFile(tokenPath()),
  );
  const saved = JSON.parse(decrypted.result) as DropboxTokens;
  if (
    typeof saved.accessToken !== 'string' ||
    !saved.accessToken ||
    typeof saved.refreshToken !== 'string' ||
    !saved.refreshToken ||
    !Number.isFinite(saved.expiresAt)
  )
    throw new Error('Reconnect Dropbox.');
  tokens = saved;
  return saved;
}

// Encrypts and atomically publishes credentials while holding the account-operation queue.
async function saveTokens(
  value: DropboxTokens,
  signal?: AbortSignal,
): Promise<void> {
  await secureStorage();
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  signal?.throwIfAborted();
  await writeFile(`${tokenPath()}.tmp`, encrypted, { mode: 0o600 });
  signal?.throwIfAborted();
  await rename(`${tokenPath()}.tmp`, tokenPath());
  tokens = value;
}

// Constructs the official SDK's OAuth helper with bounded token-endpoint requests.
function sdkAuth(signal?: AbortSignal): DropboxAuth {
  if (!DROPBOX_APP_KEY)
    throw new Error('Configure DROPBOX_APP_KEY and rebuild Yoink.');
  return new DropboxAuth({
    clientId: DROPBOX_APP_KEY,
    fetch: dropboxFetch(30_000, signal),
  });
}

// Uses the SDK to refresh an expiring credential, then encrypts the updated token data.
async function freshToken(): Promise<string> {
  const saved = await loadTokens();
  if (saved.expiresAt > Date.now() + 60_000) return saved.accessToken;
  const auth = sdkAuth();
  auth.setAccessToken(saved.accessToken);
  auth.setRefreshToken(saved.refreshToken);
  auth.setAccessTokenExpiresAt(new Date(saved.expiresAt));
  await auth.refreshAccessToken();
  const accessToken = auth.getAccessToken();
  const expiresAt = auth.getAccessTokenExpiresAt()?.getTime();
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new Error('Reconnect Dropbox.');
  await saveTokens({
    accessToken,
    refreshToken: auth.getRefreshToken(),
    expiresAt,
  });
  return accessToken;
}

// Returns an access credential only to main-process Dropbox operations.
export async function dropboxAccessToken(): Promise<string> {
  return serialized(freshToken);
}

// Creates the official API client while keeping refresh and persistence serialized between upload chunks.
export async function createDropboxClient(): Promise<Dropbox> {
  const transport = dropboxFetch(120_000);
  return new Dropbox({
    accessToken: await dropboxAccessToken(),
    fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      // Long videos can outlive an access token; the SDK transport uses the latest encrypted-cache grant.
      headers.set('Authorization', `Bearer ${await dropboxAccessToken()}`);
      return transport(input, { ...init, headers });
    },
  });
}

// Reports saved connection state without exposing tokens to the renderer.
export async function dropboxStatus(): Promise<DropboxStatus> {
  return serialized(async () => {
    try {
      await loadTokens();
      return { connected: true };
    } catch {
      return { connected: false };
    }
  });
}

// Performs a bounded browser authorization with an exact registered loopback callback.
export async function connectDropbox(): Promise<DropboxStatus> {
  return serialized(async () => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 300_000);
    const signal = controller.signal;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      await abortable(secureStorage, signal);
      try {
        await abortable(loadTokens, signal);
      } catch {
        /* The first connection has no saved account. */
      }
      if (!DROPBOX_APP_KEY) throw new Error('Missing Dropbox app key.');
      const redirect = new URL(DROPBOX_REDIRECT_URI);
      if (
        redirect.protocol !== 'http:' ||
        redirect.hostname !== '127.0.0.1' ||
        !redirect.port ||
        redirect.username ||
        redirect.password ||
        redirect.search ||
        redirect.hash ||
        redirect.pathname !== '/dropbox-callback'
      )
        throw new Error('Invalid Dropbox loopback redirect.');
      signal.throwIfAborted();
      const state = randomBytes(32).toString('hex');
      const auth = sdkAuth(signal);
      let accept!: (value: string) => void;
      let deny!: (error: Error) => void;
      const code = new Promise<string>((resolve, reject) => {
        accept = resolve;
        deny = reject;
      });
      void code.catch(() => {});
      signal.addEventListener(
        'abort',
        () => deny(new Error('Dropbox sign-in timed out.')),
        { once: true },
      );
      server = createServer((request, response) => {
        let callback: URL;
        try {
          callback = new URL(request.url ?? '/', redirect);
        } catch {
          response.writeHead(400).end('Invalid callback.');
          return;
        }
        if (
          request.method !== 'GET' ||
          callback.pathname !== redirect.pathname ||
          callback.searchParams.get('state') !== state
        ) {
          response.writeHead(400).end('Invalid callback.');
          return;
        }
        const value = callback.searchParams.get('code');
        if (!value || callback.searchParams.has('error')) {
          response.end('Dropbox connection cancelled. Return to Yoink.');
          deny(new Error('Dropbox sign-in cancelled.'));
          return;
        }
        response.end('Dropbox connection received. Return to Yoink.');
        accept(value);
      });
      await abortable(
        () =>
          new Promise<void>((resolve, reject) => {
            server!.once('error', reject);
            server!.listen(Number(redirect.port), '127.0.0.1', resolve);
          }),
        signal,
      );
      const authorization = await abortable(
        () =>
          auth.getAuthenticationUrl(
            redirect.href,
            state,
            'code',
            'offline',
            ['files.metadata.read', 'files.content.write'],
            'none',
            true,
          ),
        signal,
      );
      await abortable(
        () => shell.openExternal(new URL(authorization).href),
        signal,
      );
      const authorizationCode = await abortable(() => code, signal);
      const response = await abortable(
        () => auth.getAccessTokenFromCode(redirect.href, authorizationCode),
        signal,
      );
      const result = response.result as DropboxTokenResponse;
      signal.throwIfAborted();
      if (
        !result.access_token ||
        !result.refresh_token ||
        !result.expires_in ||
        result.expires_in <= 0
      )
        throw new Error('Dropbox did not grant offline access.');
      await saveTokens(
        {
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
          expiresAt: Date.now() + result.expires_in * 1000,
        },
        signal,
      );
      return { connected: true };
    } catch {
      return {
        connected: Boolean(tokens),
        error:
          'Could not connect Dropbox. Check the app key, registered redirect URI, public-client permissions, connection, and callback port availability.',
      };
    } finally {
      clearTimeout(deadline);
      server?.close();
      server?.closeAllConnections();
    }
  });
}

// Revokes the app's Dropbox token before deleting encrypted local credentials.
export async function disconnectDropbox(): Promise<DropboxStatus> {
  return serialized(async () => {
    try {
      // Use a fresh access token, including after the originally saved access token expires.
      const client = new Dropbox({
        accessToken: await freshToken(),
        fetch: dropboxFetch(30_000),
      });
      await client.authTokenRevoke();
      await rm(tokenPath(), { force: true });
      tokens = undefined;
      return { connected: false };
    } catch {
      return {
        connected: Boolean(tokens),
        error:
          'Could not disconnect Dropbox. Check your connection and try again.',
      };
    }
  });
}
