// Configures Electron packaging, installers, Vite builds, and security fuses.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Local packaging settings are ignored by Git.
if (existsSync('.env.local')) {
  loadEnvFile('.env.local');
}

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Yoink',
    executableName: 'Yoink',
    appBundleId: process.env.APP_BUNDLE_ID,
    ...(process.env.MAC_SIGNING_IDENTITY
      ? { osxSign: { identity: process.env.MAC_SIGNING_IDENTITY } }
      : {}),
    asar: true,
    icon: 'assets/icon',
    extraResource: ['assets/icon.png'],
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      // Upload and inject debug IDs before the application is archived and signed.
      if (process.env.SENTRY_UPLOAD_SOURCEMAPS !== '1') return;
      await promisify(execFile)(
        'sentry',
        ['sourcemap', 'upload', path.join(buildPath, '.vite')],
        {
          env: {
            ...process.env,
            SENTRY_ORG: 'pottsprojects',
            SENTRY_PROJECT: 'yoink',
          },
        },
      );
    },
  },
  makers: [
    new MakerSquirrel({ setupIcon: 'assets/icon.ico' }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({ name: 'Yoink', icon: 'assets/icon.icns' }),
    new MakerRpm({ options: { icon: 'assets/icon.png' } }),
    new MakerDeb({ options: { icon: 'assets/icon.png' } }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
