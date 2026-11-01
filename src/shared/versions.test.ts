// Tests the display format for Electron, Chromium, and Node versions.

import { describe, expect, it } from 'vitest';
import { formatVersions } from './versions';

describe('formatVersions', () => {
  it('formats runtime versions into one line', () => {
    expect(
      formatVersions({ electron: '45.1.0', chrome: '142.0.0', node: '22.0.0' }),
    ).toBe('Electron 45.1.0 · Chromium 142.0.0 · Node 22.0.0');
  });
});
