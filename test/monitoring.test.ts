// Verifies monitoring sampling, disabled configuration, and private log forwarding.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';
import { setupMonitoring } from '../src/monitoring/main';

const app = vi.hoisted(() => ({
  isPackaged: false,
  getVersion: () => '1.0.0',
}));
vi.mock('electron', () => ({ app }));
vi.mock('electron-log/main', () => ({ default: { transports: {} } }));
vi.mock('@sentry/electron/main', () => ({
  init: vi.fn<() => void>(),
  startupTracingIntegration: () => ({ name: 'StartupTracing' }),
  logger: { info: vi.fn<() => void>() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  app.isPackaged = false;
  delete log.transports.sentry;
  vi.stubGlobal('SENTRY_DSN', 'https://public@example.com/123');
});
afterEach(() => vi.unstubAllGlobals());

test('does not enable remote monitoring without a DSN', () => {
  vi.stubGlobal('SENTRY_DSN', '');
  setupMonitoring();
  expect(Sentry.init).not.toHaveBeenCalled();
  expect(log.transports.sentry).toBeUndefined();
});

test.each([
  [false, 'development', 1.0],
  [true, 'production', 0.1],
])('configures sampling for packaged=%s', (packaged, environment, rate) => {
  app.isPackaged = packaged;
  setupMonitoring();
  expect(Sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      environment,
      tracesSampleRate: rate,
      release: 'yoink@1.0.0',
      dataCollection: expect.objectContaining({
        userInfo: false,
        httpBodies: [],
      }),
    }),
  );
});

test('forwards log labels without serializing provider error data', () => {
  setupMonitoring();
  log.transports.sentry!({
    data: [
      'Download failed',
      { token: 'private', url: 'https://example.com/private' },
    ],
    level: 'info',
    date: new Date(),
  });
  expect(Sentry.logger.info).toHaveBeenCalledExactlyOnceWith('Download failed');
});
