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
