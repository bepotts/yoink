/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  yoink: { selectFolder: () => Promise<string | null> };
  versions: import('./shared/versions').Versions;
}
