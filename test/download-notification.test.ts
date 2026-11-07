// Verifies native completion alerts and graceful notification failures.

import { beforeEach, expect, test, vi } from 'vitest';
import { notifyDownloadComplete } from '../src/ipc/download-notification';

const mocks = vi.hoisted(() => ({
  supported: vi.fn<() => boolean>(),
  create: vi.fn<(options: unknown) => void>(),
  show: vi.fn<() => void>(),
  on: vi.fn<(event: string, listener: unknown) => void>(),
}));

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = mocks.supported;
    constructor(options: unknown) {
      mocks.create(options);
    }
    on = mocks.on;
    show = mocks.show;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.supported.mockReturnValue(true);
});

test('shows a native notification with sound and the destination', () => {
  notifyDownloadComplete('/tmp/Videos');
  expect(mocks.create).toHaveBeenCalledWith({
    title: 'Download complete',
    body: 'Your video has been saved to /tmp/Videos.',
    silent: false,
    ...(process.platform === 'darwin' ? { sound: 'Glass' } : {}),
  });
  expect(mocks.show).toHaveBeenCalledOnce();
});

test('skips notifications when unsupported', () => {
  mocks.supported.mockReturnValue(false);
  notifyDownloadComplete('/tmp/Videos');
  expect(mocks.create).not.toHaveBeenCalled();
});

test('notification failures do not turn a completed download into an error', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.show.mockImplementation(() => {
    throw new Error('Notifications unavailable');
  });
  expect(() => notifyDownloadComplete('/tmp/Videos')).not.toThrow();
  expect(warning).toHaveBeenCalledOnce();
  warning.mockRestore();
});
