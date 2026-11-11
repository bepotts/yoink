// Initializes Sentry error reporting, tracing, and forwarding of application logs.

import { app } from 'electron';
import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';

// Configures monitoring before windows are created, leaving it disabled without a DSN.
export function setupMonitoring(): void {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    enableOpenTelemetrySetup: true,
    release: `yoink@${app.getVersion()}`,
    environment: app.isPackaged ? 'production' : 'development',
    tracesSampleRate: app.isPackaged ? 0.1 : 1.0,
    integrations: [Sentry.startupTracingIntegration()],
    dataCollection: {
      userInfo: false,
      stackFrameVariables: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });

  log.transports.sentry = sentryTransport;
}

// Forward message labels without serializing errors, URLs, or provider payloads.
const sentryTransport: import('electron-log').Transport = Object.assign(
  (message: import('electron-log').LogMessage) => {
    const text = message.data[0];
    if (typeof text !== 'string') return;
    const level =
      message.level === 'verbose' || message.level === 'silly'
        ? 'debug'
        : message.level;
    Sentry.logger[level](text);
  },
  { level: 'info' as const, transforms: [] },
);
