# Yoink

Electron desktop app built with [Electron Forge](https://www.electronforge.io/), Vite, React and TypeScript.

## Getting started

```bash
npm install
npm start
```

Install `yt-dlp` and make it available on your PATH before downloading videos.
On macOS with Homebrew, run `brew install yt-dlp ffmpeg`. FFmpeg enables merging
separate video and audio streams. Paste a video link, select a destination folder,
then click Submit. Yoink shows download completion or an error in the window.

## Environment configuration

Copy the committed `.env.example` to `.env.local` in the project root:

```bash
cp .env.example .env.local
```

Set `APP_BUNDLE_ID` in `.env.local` to your app's bundle ID. Electron Forge
loads this file to configure `packagerConfig.appBundleId`.

`.env.local` is ignored by Git and holds your local settings. Keep personal values
out of `.env.example`; it is the shared template and should contain placeholders.

## Google Drive OAuth keys

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select
   a project and enable **Google Drive API** and **Google Picker API**.
2. Configure Google Auth Platform branding, audience, and data access with the
   scope `https://www.googleapis.com/auth/drive.file`. Add your account as a test user
   if the app is in Testing.
3. Create an OAuth client with application type **Desktop app**.
4. Copy its client ID and client secret into `.env.local` as `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET`.

## OneDrive app registration

1. In [Microsoft Entra](https://entra.microsoft.com/), register an app supporting
   organizational directories and personal Microsoft accounts.
2. Add a **Mobile and desktop applications** redirect URI: `http://localhost/callback`.
3. Add delegated Microsoft Graph permission **Files.ReadWrite**.
4. Copy the **Application (client) ID** into `.env.local` as `MICROSOFT_CLIENT_ID`.
   No client secret is needed.
5. Set `MICROSOFT_TENANT_ID` to `consumers` for personal-only registrations,
   `organizations` for work/school-only, or `common` for both. Restart development
   or rebuild after changing these settings.

## Install on macOS

Set up `.env.local` as described above, then build on a Mac:

```bash
npm install
npm run make:mac
```

Open the `.dmg` in `out/make/` and drag Yoink into Applications. The build targets
your Mac's architecture (Apple Silicon or Intel). A ZIP is also created under
`out/make/zip/darwin/`.

To build and install directly into `~/Applications/Yoink.app`, run:

```bash
npm run make:install
```

Quit Yoink before running this command to update an existing installation. It runs
`make:mac` first and installs only if the build succeeds. No administrator access
is needed for the per-user Applications folder.

These local builds are unsigned and are not notarized by Apple. Public distribution
requires configuring Developer ID signing and notarization. Video downloads also
require `yt-dlp` and FFmpeg installed on the destination Mac, as described above.

## Scripts

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm start`             | Run the app in development with hot reload            |
| `npm test`              | Unit tests (Vitest)                                   |
| `npm run test:all`      | Run unit tests, then package and run end-to-end tests |
| `npm run test:watch`    | Unit tests in watch mode                              |
| `npm run test:coverage` | Unit tests with V8 coverage report in `coverage/`     |
| `npm run test:e2e`      | Package the app, then run Playwright Electron tests   |
| `npm run lint`          | Lint (oxlint) and check formatting (oxfmt)            |
| `npm run lint:fix`      | Auto-fix lint issues and format                       |
| `npm run typecheck`     | Type-check with `tsc`                                 |
| `npm run check`         | Lint, type-check and unit test in one go              |
| `npm run package`       | Package the app into `out/`                           |
| `npm run make`          | Build distributable installers                        |

`npm run test:all` and `npm run act:all` print output to the terminal and save
both stdout and stderr to `logs/test-all.log` and `logs/act-all.log`, respectively.
Each run overwrites its log. Logs are ignored by Git, and failed commands retain
their nonzero exit codes.

## Layout

- `src/main.ts` — main process
- `src/preload.ts` — preload script; exposes a typed API to the renderer via `contextBridge`
- `src/renderer.tsx` — React renderer entry, loaded by `index.html`
- `src/App.tsx` — React UI and folder/download state
- `src/shared/` — process-agnostic code
- `test/` — Vitest unit tests, mirroring the source layout
- `e2e/` — Playwright end-to-end tests that launch the real Electron app

## Tooling

- **Vitest** for unit tests, **Playwright** for Electron e2e tests
- **oxlint** and **oxfmt** for linting and formatting
- **Husky** + **lint-staged** run lint and format on staged files before each commit
- **EditorConfig** and `.nvmrc` (Node 22) for consistent environments
- **GitHub Actions** (`.github/workflows/ci.yml`) runs lint, type-check, unit tests, and e2e tests on Linux, macOS and Windows

## Run GitHub Actions locally

Install [act](https://nektosact.com/installation/) and start Docker Desktop (or
another Docker-compatible engine). On macOS, install act with `brew install act`.
Then run these commands from the project root:

```bash
npm run act:list   # List the workflow jobs
npm run act:check  # Lint, type checks, and unit test coverage
npm run act:e2e    # Package Electron and run the Linux end-to-end tests
npm run act:ci     # Run both Linux jobs
npm run act:all    # Run all local act jobs (same as act:ci)
```

The commands execute `.github/workflows/ci.yml` using `.actrc`. Local runs use an
Ubuntu 24.04 container and the Linux matrix entry. The configuration uses amd64
containers, including emulation on Apple Silicon, to match the GitHub Linux runner.
The first run downloads the runner image, action code, and npm dependencies.
Uncommitted project changes are included; ignored files such as `node_modules`
are excluded and `npm ci` installs dependencies inside the container.

Failed end-to-end runs upload traces to `.act/artifacts/`, which is ignored by Git.
Electron's sandbox is disabled only when tests run as root in Linux containers.
macOS and Windows jobs still run on GitHub; act's Docker containers cannot emulate
those operating systems. For a native local macOS run, use `npm run test:e2e`.
