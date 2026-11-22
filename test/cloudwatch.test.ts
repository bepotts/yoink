// Verifies bounded, private CloudWatch relaying without AWS credentials in the desktop app.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import log from 'electron-log/main';
import {
  createCloudWatchTransport,
  setupCloudWatchLogging,
} from '../src/monitoring/cloudwatch';
import { configuredS3Destination } from '../src/cloud-storage/s3/config';

const app = vi.hoisted(() => ({
  on: vi.fn<
    (
      name: string,
      callback: (event: { preventDefault: () => void }) => void,
    ) => void
  >(),
  quit: vi.fn<() => void>(),
}));
vi.mock('electron', () => ({ app }));
vi.mock('electron-log/main', () => ({ default: { transports: {} } }));
vi.mock('../src/cloud-storage/s3/config', () => ({
  configuredS3Destination: vi.fn<() => { backendUrl: string }>(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  delete log.transports.cloudwatch;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Constructs a real transport record with optional sensitive extra data.
function record(
  message = 'Download started',
  level = 'info',
  extra: unknown = undefined,
): import('electron-log').LogMessage {
  return { data: [message, extra], level: level as 'info', date: new Date() };
}

test('batches only allowlisted labels and sends no provider data or URLs', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 202 }));
  const relay = createCloudWatchTransport(
    new URL('https://api.example.com/logs'),
    send,
  );
  relay.transport(record('Download started', 'info', { token: 'secret' }));
  relay.transport(record('https://example.com/?token=secret'));
  relay.transport(record('Ignored debug payload', 'debug'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledOnce();
  const options = send.mock.calls[0][1]!;
  expect(JSON.parse(options.body as string)).toEqual({
    events: [
      { level: 'info', message: 'Download started' },
      { level: 'info', message: 'Application log' },
    ],
  });
  expect(options.redirect).toBe('error');
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.stringify(options)).not.toContain('secret');
  await relay.close();
});

test('serializes concurrent flushes and retries transient failures', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(new Response(null, { status: 202 }));
  const relay = createCloudWatchTransport(
    new URL('https://example.com/logs'),
    send,
  );
  relay.transport(record());
  const first = relay.flush();
  expect(relay.flush()).toBe(first);
  await first;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(send).toHaveBeenCalledTimes(2);
  await relay.close();
});

test.each([429, 503])(
  'drops a failing batch after three attempts (HTTP %s)',
  async (status) => {
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status }));
    const relay = createCloudWatchTransport(
      new URL('https://example.com/logs'),
      send,
    );
    relay.transport(record());
    await relay.flush();
    await relay.flush();
    await relay.flush();
    await relay.flush();
    expect(send).toHaveBeenCalledTimes(3);
    await relay.close();
  },
);

test('does not retry permanent HTTP failures', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 422 }));
  const relay = createCloudWatchTransport(
    new URL('https://example.com/logs'),
    send,
  );
  relay.transport(record());
  await relay.flush();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(send).toHaveBeenCalledOnce();
  await relay.close();
});

test('bounds the queue at 200 events and each batch at twenty', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 202 }));
  const relay = createCloudWatchTransport(
    new URL('https://example.com/logs'),
    send,
  );
  for (let index = 0; index < 250; index++) relay.transport(record());
  for (let index = 0; index < 11; index++) await relay.flush();
  expect(send).toHaveBeenCalledTimes(10);
  for (const [, options] of send.mock.calls)
    expect(JSON.parse(options!.body as string).events).toHaveLength(20);
  await relay.close();
  relay.transport(record());
  await relay.flush();
  expect(send).toHaveBeenCalledTimes(10);
});

test('shutdown waits for in-flight logs and flushes the remaining batch', async () => {
  let complete!: (response: Response) => void;
  const send = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(new Response(null, { status: 202 }));
  const relay = createCloudWatchTransport(
    new URL('https://example.com/logs'),
    send,
  );
  relay.transport(record());
  void relay.flush();
  relay.transport(record('Application quitting'));
  const closed = relay.close();
  complete(new Response(null, { status: 202 }));
  await closed;
  expect(send).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(send.mock.calls[1][1]!.body as string).events[0].message,
  ).toBe('Application quitting');
});

test('installs the relay independently of Sentry and flushes on quit', async () => {
  vi.mocked(configuredS3Destination).mockReturnValue({
    backendUrl: 'https://api.example.com/base/',
  });
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', send);
  setupCloudWatchLogging();
  log.transports.cloudwatch!(record());
  const callback = app.on.mock.calls[0][1];
  const event = { preventDefault: vi.fn<() => void>() };
  callback(event);
  callback(event);
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0].toString()).toBe(
    'https://api.example.com/base/logs',
  );
});

test('keeps local logging usable when backend configuration is invalid', () => {
  vi.mocked(configuredS3Destination).mockImplementation(() => {
    throw new Error('invalid');
  });
  expect(() => setupCloudWatchLogging()).not.toThrow();
  expect(log.transports.cloudwatch).toBeUndefined();
});
