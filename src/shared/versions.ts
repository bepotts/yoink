// Defines runtime version data and formats it for display.

export interface Versions {
  node: string;
  chrome: string;
  electron: string;
}

/** Formats runtime versions as a single human-readable line. */
export const formatVersions = (versions: Versions): string =>
  `Electron ${versions.electron} · Chromium ${versions.chrome} · Node ${versions.node}`;
