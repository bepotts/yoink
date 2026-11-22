// Verifies monitoring sampling, disabled configuration, and private log forwarding.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setupCloudWatchLogging } from '../src/monitoring/cloudwatch';
import * as Sentry from '@sentry/electron/main';
import { setupMonitoring } from '../src/monitoring/main';

const app = vi.hoisted(() => ({
  isPackaged: false,
  getVersion: () => '1.0.0',
}));
vi.mock('electron', () => ({ app }));
vi.mock('../src/monitoring/cloudwatch', () => ({
  setupCloudWatchLogging: vi.fn<() => void>(),
}));
vi.mock('@sentry/electron/main', () => ({
  init: vi.fn<() => void>(),
  startupTracingIntegration: () => ({ name: 'StartupTracing' }),
  logger: { info: vi.fn<() => void>() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  app.isPackaged = false;
  vi.stubGlobal('SENTRY_DSN', 'https://public@example.com/123');
});
afterEach(() => vi.unstubAllGlobals());

test('does not enable remote monitoring without a DSN', () => {
  vi.stubGlobal('SENTRY_DSN', '');
  setupMonitoring();
  expect(Sentry.init).not.toHaveBeenCalled();
  expect(setupCloudWatchLogging).toHaveBeenCalledOnce();
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

test('keeps Sentry structured logs disabled', () => {
  setupMonitoring();
  const options = vi.mocked(Sentry.init).mock.calls[0][0];
  expect(options.beforeSendLog?.({} as never)).toBeNull();
  expect(Sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({ beforeSendLog: expect.any(Function) }),
  );
});
