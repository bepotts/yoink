// Tests parsing of yt-dlp progress, including estimates and processing updates.

import { expect, test } from 'vitest';
import { parseProgress } from '../src/download-progress';

test('calculates percentages from exact or estimated totals', () => {
  expect(
    parseProgress('yoink-progress:{"downloaded_bytes":25,"total_bytes":100}'),
  ).toEqual({ phase: 'downloading', percent: 25 });
  expect(
    parseProgress(
      'yoink-progress:{"downloaded_bytes":50,"total_bytes_estimate":200}',
    ),
  ).toEqual({ phase: 'downloading', percent: 25 });
});

test('uses indeterminate progress for an unknown total and clamps estimates', () => {
  expect(parseProgress('yoink-progress:{"downloaded_bytes":50}')).toEqual({
    phase: 'downloading',
    percent: null,
  });
  expect(
    parseProgress(
      'yoink-progress:{"downloaded_bytes":150,"total_bytes_estimate":100}',
    ),
  ).toEqual({ phase: 'downloading', percent: 100 });
});

test('reports processing after a stream finishes or postprocessing begins', () => {
  expect(parseProgress('yoink-progress:{"status":"finished"}')).toEqual({
    phase: 'processing',
    percent: null,
  });
  expect(parseProgress('yoink-processing')).toEqual({
    phase: 'processing',
    percent: null,
  });
});

test('ignores regular output and malformed progress', () => {
  expect(parseProgress('[download] Destination: video.mp4')).toBeNull();
  expect(parseProgress('yoink-progress:bad json')).toBeNull();
});
