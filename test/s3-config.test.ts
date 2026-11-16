// Verifies backend URL configuration and destination validation.
import { afterEach, expect, test, vi } from 'vitest';
import { configuredS3Destination } from '../src/cloud-storage/s3/config';
import { validateS3Destination } from '../src/cloud-storage/s3/types';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test('uses the configured backend and runtime overrides', () => {
  vi.stubEnv('YOINK_BACKEND_URL', undefined);
  vi.stubGlobal('YOINK_BACKEND_URL', 'http://localhost:8000');
  expect(configuredS3Destination()).toEqual({
    backendUrl: 'http://localhost:8000',
  });
  vi.stubEnv('YOINK_BACKEND_URL', 'https://api.example.com');
  expect(configuredS3Destination().backendUrl).toBe('https://api.example.com');
});
test('rejects invalid backend URLs', () => {
  for (const backendUrl of [
    '',
    'file:///tmp/file',
    'https://user:pass@example.com',
    'https://example.com?x=1',
  ])
    expect(validateS3Destination({ backendUrl })).toBeTypeOf('string');
  expect(validateS3Destination(null)).toBeTypeOf('string');
  vi.stubEnv('YOINK_BACKEND_URL', '');
  expect(() => configuredS3Destination()).toThrow('backend URL');
});
