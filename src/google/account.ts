// Authenticates a Google account in the system browser and stores tokens in OS-protected storage.

import { app, safeStorage, shell } from 'electron';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { google, Auth } from 'googleapis';
import type { GoogleAccountStatus } from './types/account-types';
import type { DriveFolder } from './types/drive-types';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let connecting = false;

// Locates encrypted account credentials outside the application bundle.
function tokenPath(): string {
  return path.join(app.getPath('userData'), 'google-account.enc');
}

// Rejects storage configurations that cannot protect account credentials.
async function requireSecureStorage(): Promise<void> {
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error(
      'Secure credential storage is unavailable. Enable your operating system keyring and try again.',
    );
  }
}

// Creates an installed-application OAuth client using build-time Google Cloud configuration.
function oauthClient(redirectUri?: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'Configure the Google Desktop OAuth client in .env.local and rebuild Yoink.',
    );
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
}

// Loads credentials into a main-process client; googleapis refreshes access tokens automatically.
async function authenticatedClient() {
  const client = oauthClient();
  await requireSecureStorage();
  const encrypted = await readFile(tokenPath());
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  client.setCredentials(JSON.parse(decrypted.result));
  return client;
}

// Reports saved connection state without sending tokens to the renderer.
export async function googleAccountStatus(): Promise<GoogleAccountStatus> {
  try {
    const client = await authenticatedClient();
    return {
      // Older grants must reconnect to use Picker-selected file access.
      needsReconnect: !client.credentials.scope
        ?.split(' ')
        .includes(DRIVE_SCOPE),
      /* Saved credentials are available; authorization is checked on API calls. */ connected: true,
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
      return { /* No saved account. */ connected: false };
    return {
      /* No usable credentials. */ connected: false,
      /* Safe setup guidance. */ error:
        'Google is not connected. Check OAuth configuration and secure storage, then connect again.',
    };
  }
}

// Returns a Drive v3 client for main-process API calls using the connected account.
export async function createDriveClient() {
  const auth = await authenticatedClient();
  if (!auth.credentials.scope?.split(' ').includes(DRIVE_SCOPE)) {
    throw new Error(
      'Reconnect Google Drive to use Google Picker and upload access.',
    );
  }
  return google.drive({
    // Use the supported Drive API version.
    version: 'v3',
    // Keep authentication and tokens entirely within the main process.
    auth,
  });
}

// Runs browser OAuth, optionally invoking Google's folder-only desktop Picker.
async function authorizeGoogleAccount(
  pickFolder: boolean,
): Promise<DriveFolder | null> {
  if (connecting) throw new Error('Google sign-in is already in progress.');
  connecting = true;
  try {
    await requireSecureStorage();
    // Validate configuration before creating a listener or opening the browser.
    oauthClient();
    const state = randomBytes(32).toString('hex');
    let acceptCallback!: (url: URL) => void;
    let rejectCallback!: (error: Error) => void;
    const callbackPromise = new Promise<URL>((resolve, reject) => {
      acceptCallback = resolve;
      rejectCallback = reject;
    });
    // Handle early browser failures without leaving a rejected promise unobserved.
    void callbackPromise.catch(() => {});
    const server = createServer((request, response) => {
      let url: URL;
      try {
        url = new URL(request.url ?? '/', 'http://127.0.0.1');
      } catch {
        response.writeHead(400).end('Invalid sign-in callback.');
        return;
      }
      if (
        request.method !== 'GET' ||
        url.pathname !== '/oauth2callback' ||
        url.searchParams.get('state') !== state
      ) {
        response.writeHead(400).end('Invalid sign-in callback.');
        return;
      }
      if (url.searchParams.has('error') || !url.searchParams.get('code')) {
        response.writeHead(400).end('Sign-in cancelled. Return to Yoink.');
        rejectCallback(new Error('Google sign-in was cancelled.'));
        return;
      }
      response.end('Selection received. You can return to Yoink.');
      acceptCallback(url);
    });
    const timeout = setTimeout(
      () => rejectCallback(new Error('Google sign-in timed out.')),
      pickFolder ? 300_000 : 120_000,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Could not start Google sign-in.');
      const client = oauthClient(
        `http://127.0.0.1:${address.port}/oauth2callback`,
      );
      const codes = await client.generateCodeVerifierAsync();
      const authorizationUrl = new URL(
        client.generateAuthUrl({
          // Persist offline access for uploads after the browser closes.
          access_type: 'offline',
          // Explicitly grant access when connecting or choosing another folder.
          prompt: 'consent',
          // Desktop Picker requires only the per-file scope.
          scope: [DRIVE_SCOPE],
          // Do not combine legacy broad Drive scopes with this Picker request.
          include_granted_scopes: false,
          // Bind the callback to this request.
          state,
          // Protect the authorization code with PKCE.
          code_challenge: codes.codeChallenge,
          // Use the SHA-256 challenge algorithm.
          code_challenge_method: Auth.CodeChallengeMethod.S256,
        }),
      );
      if (pickFolder) {
        authorizationUrl.searchParams.set('trigger_onepick', 'true');
        authorizationUrl.searchParams.set('allow_folder_selection', 'true');
        authorizationUrl.searchParams.set('allow_multiple', 'false');
        authorizationUrl.searchParams.set(
          'mimetypes',
          'application/vnd.google-apps.folder',
        );
      }
      await shell.openExternal(authorizationUrl.href);
      const callback = await callbackPromise;
      const pickedIds = callback.searchParams.get('picked_file_ids');
      // Closing Picker without choosing a folder must preserve the existing connection.
      if (pickFolder && !pickedIds) return null;
      if (pickFolder && !/^[a-zA-Z0-9_-]{1,256}$/.test(pickedIds!)) {
        throw new Error('Google Picker did not return a single folder.');
      }
      const { tokens } = await client.getToken({
        // Exchange only the code from the state-validated callback.
        code: callback.searchParams.get('code')!,
        // Prove ownership of the original request.
        codeVerifier: codes.codeVerifier,
      });
      if (
        !tokens.refresh_token ||
        !tokens.scope?.split(' ').includes(DRIVE_SCOPE)
      ) {
        throw new Error('Google did not grant offline file access.');
      }
      client.setCredentials(tokens);
      const drive = google.drive({
        // Use Drive v3 to verify the selected destination.
        version: 'v3',
        // Validate using the newly granted credentials before saving them.
        auth: client,
      });
      let folder: DriveFolder | null = null;
      if (pickFolder) {
        const { data } = await drive.files.get({
          // Resolve only the single identifier returned by Picker.
          fileId: pickedIds!,
          // Verify the destination really is a writable folder.
          fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)',
          // Allow writable shared-drive destinations.
          supportsAllDrives: true,
        });
        if (
          !data.id ||
          !data.name ||
          data.mimeType !== 'application/vnd.google-apps.folder' ||
          data.trashed ||
          !data.capabilities?.canAddChildren
        ) {
          throw new Error('Please choose a writable Google Drive folder.');
        }
        folder = {
          // Canonical Drive folder identifier.
          id: data.id,
          // User-facing folder name, without returning tokens to the renderer.
          name: data.name,
        };
      } else {
        await drive.about.get({
          // Verify the project has Drive API access without listing account files.
          fields: 'kind',
        });
      }
      const encrypted = await safeStorage.encryptStringAsync(
        JSON.stringify(tokens),
      );
      const temporary = `${tokenPath()}.tmp`;
      await writeFile(temporary, encrypted, {
        // Restrict the credential file to this user.
        mode: 0o600,
      });
      await rename(temporary, tokenPath());
      return folder;
    } finally {
      clearTimeout(timeout);
      server.close();
      server.closeAllConnections();
    }
  } finally {
    connecting = false;
  }
}

// Connects a Google account while keeping provider errors and credentials in the main process.
export async function connectGoogleAccount(): Promise<GoogleAccountStatus> {
  try {
    await authorizeGoogleAccount(false);
    return {
      // Authentication and encrypted storage succeeded.
      connected: true,
    };
  } catch {
    return {
      // Preserve the previous connection and its reconnect requirement on failure.
      ...(await googleAccountStatus()),
      // Do not expose Google provider responses or credential payloads.
      error:
        'Google sign-in failed or was cancelled. Check Desktop OAuth configuration, Drive API access, and your keyring, then try again.',
    };
  }
}

// Opens Google's folder Picker in the system browser and returns a verified upload destination.
export async function selectDriveFolder(): Promise<DriveFolder | null> {
  try {
    return await authorizeGoogleAccount(true);
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === 'Google sign-in was cancelled.'
    )
      return null;
    // Provider errors can contain credentials; return only sanitized guidance over IPC.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      'Google Picker could not select a folder. Enable Google Picker API in your Cloud project, check your connection, and choose a writable folder.',
    );
  }
}

// Revokes Google authorization before removing the locally encrypted credentials.
export async function disconnectGoogleAccount(): Promise<GoogleAccountStatus> {
  if (connecting)
    return {
      /* Keep existing state during authorization. */ connected: (
        await googleAccountStatus()
      ).connected,
      /* Avoid credentials being recreated after disconnect. */ error:
        'Wait for Google sign-in to finish before disconnecting.',
    };
  try {
    const client = await authenticatedClient();
    await client.revokeCredentials();
    await rm(tokenPath(), {
      /* Missing files are already disconnected. */ force: true,
    });
    return { /* Account is revoked and removed. */ connected: false };
  } catch {
    return {
      /* Keep credentials so revocation can be retried. */ connected: (
        await googleAccountStatus()
      ).connected,
      /* Explain that revocation did not finish. */ error:
        'Could not revoke Google access. Check your connection and try again.',
    };
  }
}
