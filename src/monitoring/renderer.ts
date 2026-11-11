// Initializes renderer monitoring before React and application modules are loaded.

import * as Sentry from '@sentry/electron/renderer';
import { init as reactInit } from '@sentry/react';

if (SENTRY_ENABLED) {
  Sentry.init(
    {
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
      ],
      tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      dataCollection: {
        userInfo: false,
        stackFrameVariables: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
    },
    reactInit,
  );
}
