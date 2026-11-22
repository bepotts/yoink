// Initializes Sentry error reporting and tracing alongside CloudWatch log delivery.

import { app } from 'electron';
import { setupCloudWatchLogging } from './cloudwatch';
import * as Sentry from '@sentry/electron/main';

// Configures monitoring before windows are created, leaving it disabled without a DSN.
export function setupMonitoring(): void {
  setupCloudWatchLogging();
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    beforeSendLog: () => null,
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
}
