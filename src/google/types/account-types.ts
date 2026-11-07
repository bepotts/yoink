// Defines the non-sensitive Google connection state exposed to the renderer.

export interface GoogleAccountStatus {
  // Whether credentials are saved for a Google account.
  connected: boolean;
  // Whether an older grant needs upload permissions.
  needsReconnect?: boolean;
  // Actionable connection failure, without credentials or provider payloads.
  error?: string;
}
