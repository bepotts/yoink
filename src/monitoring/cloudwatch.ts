// Batches private log labels to the backend without embedding AWS credentials in Electron.
import { app } from 'electron';
import log from 'electron-log/main';
import { configuredS3Destination } from '../cloud-storage/s3/config';
import { cloudWatchLogLabels } from './log-labels';

interface LogEvent {
  // Restricts severity to the ingestion endpoint's supported application levels.
  level: 'info' | 'warn' | 'error';
  // Contains a fixed application label, never error objects or request data.
  message: string;
}

// Builds an isolated, bounded log transport with serialized sends and finite retries.
export function createCloudWatchTransport(
  endpoint: URL,
  send: typeof fetch = fetch,
) {
  const queue: LogEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let failures = 0;
  let closed = false;

  // Schedules a background batch without preventing the process from exiting.
  function schedule(): void {
    if (closed || timer || queue.length === 0) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void flush();
      },
      Math.min(60_000, 5000 * 2 ** failures),
    );
    timer.unref();
  }

  // Sends at most twenty allowlisted events and retries only transient failures.
  function flush(): Promise<void> {
    if (pending) return pending;
    if (queue.length === 0) return Promise.resolve();
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = queue.splice(0, 20);
    pending = (async () => {
      try {
        const response = await send(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });
        if (!response.ok && (response.status === 429 || response.status >= 500))
          throw new Error('Log delivery temporarily unavailable');
        failures = 0;
      } catch {
        failures += 1;
        if (failures < 3) queue.unshift(...batch);
        else {
          failures = 0;
        }
        queue.splice(200);
      } finally {
        pending = undefined;
        schedule();
      }
    })();
    return pending;
  }

  // Forwards fixed message labels only, dropping excess queued logs during outages.
  const transport: import('electron-log').Transport = Object.assign(
    (record: import('electron-log').LogMessage) => {
      if (closed || !['info', 'warn', 'error'].includes(record.level)) return;
      const label = record.data[0];
      queue.push({
        level: record.level as LogEvent['level'],
        message:
          typeof label === 'string' && cloudWatchLogLabels.has(label)
            ? label
            : 'Application log',
      });
      if (queue.length > 200) queue.shift();
      schedule();
    },
    { level: 'info' as const, transforms: [] },
  );

  // Stops timers and gives pending logs one bounded, best-effort shutdown flush.
  async function close(): Promise<void> {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending) await pending;
    if (queue.length) await flush();
    queue.length = 0;
  }

  return { transport, flush, close };
}

// Installs CloudWatch forwarding independently of whether Sentry error reporting is enabled.
export function setupCloudWatchLogging(): void {
  let endpoint: URL;
  try {
    endpoint = new URL(configuredS3Destination().backendUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/logs`;
  } catch {
    return;
  }
  const relay = createCloudWatchTransport(endpoint);
  log.transports.cloudwatch = relay.transport;
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    // Let the other lifecycle handlers enqueue their final labels before flushing.
    void Promise.resolve()
      .then(() => relay.close())
      .finally(() => app.quit());
  });
}
