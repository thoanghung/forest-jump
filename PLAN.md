# Worktree Dev Runner — Desktop App Plan

## Context
The user runs several AI agents at once, each in its own git worktree. To test one, they must `cd` into
that worktree and run the dev command manually (`expo start` for mobile, `npm run start:dev` for NestJS).
Goal: a Linux desktop app that lists all worktrees of each registered project and starts/stops the dev env
for any worktree in one click. **No FE/BE pairing.** Decisions from user:
- **Parallel runs**: several worktrees of the same project may run at once → app assigns a distinct port to each.
- **Dev command set per project** (pre-filled from package.json scripts), applies to all its worktrees.
- **Bootstrap**: detect missing `.env*` / `node_modules`, offer one-click copy-from-main + install.

Target dir `/media/ht-home/LinuxExtend/code/env-control` is empty (greenfield). Toolchain: Node 24, pnpm 10, no Rust → Electron.

## Stack
Electron + electron-vite + React + TypeScript, `node-pty` (real TTY so Expo QR code & key shortcuts work),
`@xterm/xterm` + fit addon for log panes, `chokidar` (watch worktree changes), `zod` (config validation),
`electron-store` or a JSON file in `app.getPath('userData')` for config. Tailwind for UI. pnpm.

## Data model (`src/shared/types.ts`)
```ts
Project { id, name, repoPath, command, basePort, portEnv?: string /* e.g. "PORT" */,
          env?: Record<string,string>, packageManager: 'pnpm'|'npm'|'yarn'|'bun' }
Worktree { path, branch, head, isMain, locked, dirty, ahead, behind, missingEnv: string[], missingNodeModules }
RunState { worktreePath, port, pid, status: 'starting'|'running'|'exited'|'crashed', exitCode? }
```
`command` supports `${port}` placeholder, e.g. `npx expo start --port ${port}` or `pnpm start:dev` with `portEnv: PORT`.

## Main-process services (`src/main/`, no Electron imports so they're unit-testable)
1. **`config.ts`** — load/save projects JSON, zod-validate.
2. **`worktrees.ts`** — `git -C <repo> worktree list --porcelain` → parse; per worktree `git status --porcelain`
   (dirty) and `git rev-list --left-right --count @{u}...HEAD` (ahead/behind, tolerate no upstream).
   Detect project type & scripts from `package.json`; detect package manager from lockfile.
   Watch `<repo>/.git/worktrees/` with chokidar → push `worktrees:changed` event.
3. **`ports.ts`** — `allocatePort(basePort, taken)`: first port ≥ basePort not used by our runs and free
   (probe with `net.createServer().listen`). Also `whoUsesPort` via `ss -ltnp` for conflict display.
4. **`process-manager.ts`** — `start(project, worktree)`: allocate port, render command, spawn via
   `node-pty` with `cwd=worktree`, env = process.env + project.env + `{[portEnv]: port}`; keep a 5k-line
   ring buffer per run; stream data over IPC. `stop`: SIGTERM to the process group (`process.kill(-pid)`),
   SIGKILL after 5s. `write(runId, data)` to forward keys (Expo `r`, `a`, `i`). Kill all on app quit.
   Note: login shell PATH — spawn through `$SHELL -lc "<cmd>"` so nvm/pnpm on PATH work from a desktop launcher.
5. **`bootstrap.ts`** — list `.env*` files (gitignored) present in main worktree but missing in target → copy;
   run `<pm> install` in a pty with output shown in the log pane.
6. **`ipc.ts`** — typed handlers: `projects:list/add/update/remove`, `worktrees:list`, `run:start/stop/write`,
   `bootstrap:run`, `open:editor` (`code <path>`), `open:terminal`, `open:folder`; events `run:data`, `run:status`, `worktrees:changed`.

## UI (`src/renderer/`)
- **Left sidebar**: projects; "+ Add project" dialog → pick folder (must be git repo), auto-fills name, command
  (dropdown of package.json scripts), base port (8081 if expo dep, 3000 if @nestjs/core, else blank).
- **Main list**: worktree rows of selected project — branch, path, dirty/ahead/behind badges, warning chips
  for missing `.env` / `node_modules` with "Set up" button, status dot + port when running,
  buttons ▶ Start / ■ Stop / ↻ Restart / Open in VS Code / Terminal.
- **Bottom/right log panel**: tabs per running worktree, xterm.js attached to the pty (interactive input).
- **Ctrl+K quick switcher**: fuzzy search across all projects' worktrees → Enter starts it.
- Tray icon listing running envs with Stop actions (v2 if time).

## Layout
```
env-control/
  electron.vite.config.ts  package.json  tsconfig*.json
  src/main/{index.ts, ipc.ts, config.ts, worktrees.ts, ports.ts, process-manager.ts, bootstrap.ts}
  src/preload/index.ts      # contextBridge typed API
  src/renderer/{main.tsx, App.tsx, components/*, store.ts (zustand)}
  src/shared/types.ts
  tests/ (vitest: worktree porcelain parser, port allocator, command templating)
```

## Build order
1. Scaffold electron-vite React-TS, add deps, `electron-rebuild` for node-pty.
2. `worktrees.ts` + `config.ts` + tests → list worktrees in UI.
3. `process-manager.ts` + `ports.ts` → start/stop with xterm log panel.
4. Bootstrap, open-in-editor/terminal, chokidar refresh.
5. Quick switcher, tray, `electron-builder` AppImage/.deb packaging.

## Verification
- `pnpm test` — vitest for porcelain parsing, port allocation, `${port}` templating.
- `pnpm dev` — add a real repo; create 2 worktrees (`git worktree add ../x-feat-a -b feat-a`); confirm both
  appear live; start both → distinct ports (e.g. 8081/8082), logs streaming, Expo QR visible, `r` key reloads.
- Stop → confirm port released (`ss -ltnp | grep 8081` empty, no orphan node/metro processes).
- Delete `.env`/`node_modules` in a worktree → warning chip → "Set up" restores them.
- Quit app while running → all child processes gone.
