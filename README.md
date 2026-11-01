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

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `npm start`             | Run the app in development with hot reload          |
| `npm test`              | Unit tests (Vitest)                                 |
| `npm run test:watch`    | Unit tests in watch mode                            |
| `npm run test:coverage` | Unit tests with V8 coverage report in `coverage/`   |
| `npm run test:e2e`      | Package the app, then run Playwright Electron tests |
| `npm run lint`          | Lint (oxlint) and check formatting (oxfmt)          |
| `npm run lint:fix`      | Auto-fix lint issues and format                     |
| `npm run typecheck`     | Type-check with `tsc`                               |
| `npm run check`         | Lint, type-check and unit test in one go            |
| `npm run package`       | Package the app into `out/`                         |
| `npm run make`          | Build distributable installers                      |

## Layout

- `src/main.ts` — main process
- `src/preload.ts` — preload script; exposes a typed API to the renderer via `contextBridge`
- `src/renderer.tsx` — React renderer entry, loaded by `index.html`
- `src/App.tsx` — React UI and folder/download state
- `src/shared/` — process-agnostic code, unit tested with `*.test.ts` files alongside it
- `e2e/` — Playwright end-to-end tests that launch the real Electron app

## Tooling

- **Vitest** for unit tests, **Playwright** for Electron e2e tests
- **oxlint** and **oxfmt** for linting and formatting
- **Husky** + **lint-staged** run lint and format on staged files before each commit
- **EditorConfig** and `.nvmrc` (Node 22) for consistent environments
- **GitHub Actions** (`.github/workflows/ci.yml`) runs lint, type-check, unit tests, and e2e tests on Linux, macOS and Windows
