// Signs in Microsoft accounts with PKCE and stores the MSAL token cache using OS encryption.

import { app, safeStorage, shell } from 'electron';
import {
  PublicClientApplication,
  type NetworkRequestOptions,
  type NetworkResponse,
} from '@azure/msal-node';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { OneDriveStatus } from './types/onedrive-types';

const SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite',
  'offline_access',
];
let account:
  | {
      // Shared MSAL instance retains refreshed access tokens.
      client: PublicClientApplication;
      // Explicit account identity avoids silently switching between cached users.
      id: string;
    }
  | undefined;
let queue: Promise<unknown> = Promise.resolve();

// Serializes all cache mutations, including silent refresh, login, and disconnect.
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const pending = queue.then(operation);
  queue = pending.catch(() => {});
  return pending;
}

// Stops stalled authorization work at the shared deadline, even if a provider ignores cancellation.
async function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Microsoft sign-in timed out.'));
    signal.addEventListener('abort', abort, {
      once: true,
    });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

// Keeps Microsoft credentials outside the app bundle and source tree.
function cachePath(): string {
  return path.join(app.getPath('userData'), 'onedrive-account.enc');
}

// Requires OS-backed encryption rather than falling back to plaintext storage.
async function secureStorage(): Promise<void> {
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error(
      'Enable your operating system keyring to connect OneDrive.',
    );
  }
}

// Supplies MSAL with bounded HTTP requests that also respect an interactive authorization deadline.
function microsoftClient(signal?: AbortSignal): PublicClientApplication {
  if (!MICROSOFT_CLIENT_ID)
    throw new Error(
      'Configure MICROSOFT_CLIENT_ID in .env.local and rebuild Yoink.',
    );
  const tenant = MICROSOFT_TENANT_ID || 'common';
  if (
    !['common', 'consumers', 'organizations'].includes(tenant) &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenant,
    )
  ) {
    throw new Error(
      'Configure a valid MICROSOFT_TENANT_ID for the app registration.',
    );
  }
  // Implements the HTTP boundary without logging provider responses or credentials.
  async function request<T>(
    url: string,
    method: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> {
    const response = await fetch(url, {
      method,
      headers: options?.headers,
      body: options?.body,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: (await response.json()) as T,
    };
  }
  return new PublicClientApplication({
    auth: {
      clientId: MICROSOFT_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${tenant}`,
    },
    system: {
      networkClient: {
        sendGetRequestAsync: <T>(
          url: string,
          options?: NetworkRequestOptions,
        ) => request<T>(url, 'GET', options),
        sendPostRequestAsync: <T>(
          url: string,
          options?: NetworkRequestOptions,
        ) => request<T>(url, 'POST', options),
      },
    },
  });
}

// Loads one encrypted cache and retains the selected account across app launches.
async function loadAccount() {
  if (account) return account;
  await secureStorage();
  const encrypted = await readFile(cachePath());
  const stored = JSON.parse(
    (await safeStorage.decryptStringAsync(encrypted)).result,
  );
  const client = microsoftClient();
  if (typeof stored.cache !== 'string' || typeof stored.id !== 'string')
    throw new Error('Invalid Microsoft account cache.');
  client.getTokenCache().deserialize(stored.cache);
  const user = await client.getTokenCache().getAccountByHomeId(stored.id);
  if (!user) throw new Error('Reconnect OneDrive.');
  account = {
    client,
    id: stored.id,
  };
  return account;
}

// Atomically persists refreshed credentials while account operations remain serialized.
async function persist(
  client: PublicClientApplication,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const encrypted = await safeStorage.encryptStringAsync(
    JSON.stringify({
      cache: client.getTokenCache().serialize(),
      id,
    }),
  );
  signal?.throwIfAborted();
  const temporary = `${cachePath()}.tmp`;
  await writeFile(temporary, encrypted, {
    mode: 0o600,
  });
  signal?.throwIfAborted();
  await rename(temporary, cachePath());
}

// Returns only connection state to the renderer.
export async function oneDriveStatus(): Promise<OneDriveStatus> {
  return serialized(async () => {
    try {
      await loadAccount();
      return { /* Account is saved locally. */ connected: true };
    } catch {
      return {
        connected: false,
      };
    }
  });
}

// Opens browser sign-in using a temporary loopback callback, state validation, and PKCE.
export async function connectOneDrive(): Promise<OneDriveStatus> {
  return serialized(async () => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 300_000);
    const signal = controller.signal;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      await abortable(secureStorage, signal);
      signal.throwIfAborted();
      // Preserve an existing connection if a replacement sign-in is cancelled.
      try {
        await abortable(loadAccount, signal);
      } catch {
        /* A first-time connection has no saved cache. */
      }
      signal.throwIfAborted();
      const client = microsoftClient(signal);
      const state = randomBytes(32).toString('hex');
      const verifier = randomBytes(32).toString('base64url');
      let accept!: (code: string) => void;
      let deny!: (error: Error) => void;
      const code = new Promise<string>((resolve, reject) => {
        accept = resolve;
        deny = reject;
      });
      void code.catch(() => {});
      signal.addEventListener(
        'abort',
        () => deny(new Error('Microsoft sign-in timed out.')),
        {
          once: true,
        },
      );
      server = createServer((request, response) => {
        let url: URL;
        try {
          url = new URL(request.url ?? '/', 'http://localhost');
        } catch {
          response.writeHead(400).end('Invalid sign-in callback.');
          return;
        }
        if (
          request.method !== 'GET' ||
          url.pathname !== '/callback' ||
          url.searchParams.get('state') !== state
        ) {
          response.writeHead(400).end('Invalid sign-in callback.');
          return;
        }
        const value = url.searchParams.get('code');
        if (!value || url.searchParams.has('error')) {
          response.end('Sign-in cancelled. Return to Yoink.');
          deny(new Error('Microsoft sign-in cancelled.'));
          return;
        }
        response.end('Sign-in received. Return to Yoink.');
        accept(value);
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Could not start Microsoft sign-in.');
      const redirectUri = `http://localhost:${address.port}/callback`;
      const url = await abortable(
        () =>
          client.getAuthCodeUrl({
            scopes: SCOPES,
            redirectUri,
            state,
            codeChallenge: createHash('sha256')
              .update(verifier)
              .digest('base64url'),
            codeChallengeMethod: 'S256',
            prompt: 'select_account',
          }),
        signal,
      );
      signal.throwIfAborted();
      await abortable(() => shell.openExternal(url), signal);
      const authorizationCode = await abortable(() => code, signal);
      const result = await abortable(
        () =>
          client.acquireTokenByCode({
            code: authorizationCode,
            scopes: SCOPES,
            redirectUri,
            codeVerifier: verifier,
          }),
        signal,
      );
      signal.throwIfAborted();
      if (!result.account)
        throw new Error('Microsoft did not return an account.');
      await persist(client, result.account.homeAccountId, signal);
      // Rehydrate into a fresh client so future refreshes are independent of the login deadline.
      const restored = microsoftClient();
      restored.getTokenCache().deserialize(client.getTokenCache().serialize());
      account = {
        client: restored,
        id: result.account.homeAccountId,
      };
      return {
        connected: true,
      };
    } catch {
      return {
        connected: Boolean(account),
        error:
          'Could not connect OneDrive. Check MICROSOFT_CLIENT_ID, the desktop redirect URI, account permissions, and your connection.',
      };
    } finally {
      clearTimeout(deadline);
      server?.close();
      server?.closeAllConnections();
    }
  });
}

// Refreshes access silently and persists MSAL's rotated refresh tokens before returning an access token.
export async function oneDriveAccessToken(): Promise<string> {
  return serialized(async () => {
    const saved = await loadAccount();
    const user = await saved.client
      .getTokenCache()
      .getAccountByHomeId(saved.id);
    if (!user) throw new Error('Reconnect OneDrive.');
    const result = await saved.client.acquireTokenSilent({
      account: user,
      scopes: SCOPES,
    });
    await persist(saved.client, saved.id);
    return result.accessToken;
  });
}

// Removes local Microsoft credentials; Microsoft account-wide session revocation is not requested.
export async function disconnectOneDrive(): Promise<OneDriveStatus> {
  return serialized(async () => {
    try {
      await rm(cachePath(), {
        force: true,
      });
      account = undefined;
      return { /* Local credentials were removed. */ connected: false };
    } catch {
      return {
        connected: Boolean(account),
        error: 'Could not disconnect OneDrive. Please try again.',
      };
    }
  });
}
