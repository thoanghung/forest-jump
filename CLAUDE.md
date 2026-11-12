# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Forest Jump** — a Linux Electron desktop app that lists every git worktree of registered projects and runs each worktree's dev command (e.g. `expo start`, `npm run start:dev`) in one click, several in parallel. Each worktree's own `.env` files supply its env vars and port; the app has a built-in `.env` editor.

## Commands

```bash
pnpm install              # postinstall runs electron-rebuild for node-pty (native module)
pnpm dev                  # electron-vite dev with HMR
pnpm typecheck            # tsc for both tsconfig.node.json (main/preload/tests) and tsconfig.web.json (renderer)
pnpm test                 # vitest run (tests/**/*.test.ts, node environment)
pnpm vitest run tests/env-files.test.ts        # single file
pnpm vitest run -t "parseDotenv"               # single test by name
pnpm build                # electron-vite build → out/
pnpm dist                 # build + electron-builder AppImage/.deb → dist/
pnpm rebuild              # re-run electron-rebuild for node-pty after Electron upgrades
```

There is no linter configured. Package manager is pnpm.

## Architecture

Three Electron processes, wired by electron-vite (`electron.vite.config.ts`):

- **`src/main/`** — all logic. `index.ts` boots the app; `ipc.ts` registers every `ipcMain` handler and is the only file that glues the services together. The services (`worktrees.ts`, `process-manager.ts`, `env-files.ts`, `ports.ts`, `detect.ts`, `config.ts`, `bootstrap.ts`) deliberately avoid importing `electron` so they're unit-testable with vitest.
- **`src/preload/index.ts`** — exposes `window.api` via `contextBridge`. It must implement the `Api` interface in `src/shared/types.ts`.
- **`src/renderer/`** — React 19 UI, no state library; state lives in `App.tsx` and flows down. Imports shared types via the `@shared/*` alias.

**Adding an IPC call touches four places:** the `Api` interface in `src/shared/types.ts` → the handler in `src/main/ipc.ts` → the bridge in `src/preload/index.ts` → the caller in the renderer. Push events (main → renderer) use `webContents.send` + an `on*` subscriber in the preload that returns an unsubscribe function.

### Key behaviours spanning files

- **Runs (`process-manager.ts`)**: one run slot per worktree, keyed by the worktree's absolute path (`RunInfo.id === worktreePath`). A dev run and a setup run (`<pm> install`) share that slot. A run that ends as `exited` (stopped by the user or exit code 0) is removed right away, closing its log tab; `crashed` runs stay until closed. Commands are spawned through `node-pty` as `$SHELL -ilc "<command>"` (interactive login shell so nvm/pnpm from rc files are on PATH). `childEnv()` strips `ELECTRON_*`, `NODE_ENV`, `NODE_OPTIONS` and `VITE_*` from the inherited env so they don't leak into user dev servers.
- **Killing**: node-pty makes the child a session leader, so stop sends signals to the process group (`process.kill(-pid)`), SIGTERM then SIGKILL after 5s. Quitting the app (`before-quit` in `index.ts`) awaits `stopAll()`.
- **Log streaming**: main keeps a 512 KB ring buffer per run plus a monotonic char counter (`total`). Data events carry `end` (counter after the chunk); `getLog` returns `{text, end}`. `LogPanel.tsx` uses these offsets to merge a snapshot with live events without duplicates — keep that contract if you touch either side. Output is batched to ~16 ms IPC messages.
- **Ports and env (`env-files.ts`)**: no port allocation. `startDev` in `ipc.ts` loads the worktree's env (`.env` < `.env.development` < `.env.local` < `.env.development.local`), injects it into the process, and takes the port from the first of `PORT`, `RCT_METRO_PORT`, `EXPO_PORT`, `APP_PORT`, `SERVER_PORT`. If that port is busy it throws an error containing "already in use"; the renderer matches that text to open the `.env` editor.
- **Readiness**: a run with a known port stays `starting` until `isPortListening` succeeds (polled every 1s), then becomes `running`.
- **`.env` file access**: `env:*` handlers only accept a path that `resolveWorktree()` finds among a configured project's worktrees, and file names passing `safeEnvName()` (`/^\.env[\w.-]*$/`). Writes are atomic (tmp + rename, mode 0600).
- **Worktree discovery (`worktrees.ts`)**: parses `git worktree list --porcelain` (first entry = main worktree). Missing `.env*` = present in main but not in this worktree. `ipc.ts` watches the shared git dir (`git rev-parse --git-common-dir`) with chokidar — only `worktrees/<name>` and its `HEAD`, plus the main `HEAD` — and emits a debounced `worktrees:changed`. The renderer also refreshes on window focus.
- **Config (`config.ts`)**: JSON at `~/.config/forest-jump/config.json` (userData is pinned in `index.ts`; the old `~/.config/env-control/config.json` is copied over once). Validated with zod; unknown/removed fields are stripped, and an invalid file is moved aside as `config.json.broken-<ts>`. A project is only `{id, name, repoPath, command}`. Package manager is detected from the lockfile when needed.

## Notes

- "Open in editor/terminal" (`src/main/launch.ts`) spawns the configured command without a shell; `{path}` is substituted per argument after quote-aware splitting.
- `sandbox: false` in `BrowserWindow` is required because the preload is bundled as CJS with Node imports.
- `node-pty` is externalized and must be `asarUnpack`ed (see `build` in `package.json`); after changing the Electron version run `pnpm rebuild`.
- `tests/worktrees.test.ts` creates real git repos in a temp dir, so `git` must be on PATH.
