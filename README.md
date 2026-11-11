# Forest Jump

Desktop app (Electron) that lists every git worktree of your projects and starts the dev env of any of them in one click — several at once, each on its own port.

## Use

```bash
pnpm install
pnpm dev          # run the app in dev mode
pnpm test         # unit tests
pnpm dist         # build AppImage + .deb into dist/
```

1. **+ Add project** → pick the repo folder (main checkout or any worktree). Name and dev command are pre-filled from `package.json` (Expo → `expo start`, NestJS → `start:dev`).
2. All worktrees appear with branch, modified / ahead / behind badges. New worktrees (e.g. created by an agent) show up automatically.
3. **▶ Run** starts the dev command in that worktree with the worktree's `.env` files loaded (`.env` < `.env.development` < `.env.local` < `.env.development.local`). Several worktrees can run at once.
4. **Ports come from each worktree's `.env`**: the first of `PORT`, `RCT_METRO_PORT`, `EXPO_PORT`, `APP_PORT`, `SERVER_PORT`. It's shown as a `:port` link, and if it's already taken Run refuses and opens the `.env` editor so you can change it.
5. **.env** button → popup to view/edit the worktree's `.env*` files (tabs per file, Ctrl+S to save, create new files, copy a file from the main worktree). If the worktree is running you get a "Restart to apply" button.
6. Logs open in the bottom panel — it's a real terminal, so Expo's QR code and keys (`r` reload, `a` Android, `i` iOS) work.
7. Worktrees missing `.env*` files or `node_modules` get a **Set up** button: copies `.env*` from the main worktree (never overwrites) and runs install with the package manager detected from the lockfile.
8. **Ctrl+K**: jump to any worktree across projects; Enter runs it (or shows its logs if already running).

Commands run through your login shell (`$SHELL -ilc`), so nvm/pnpm from your shell rc are on `PATH`. Stop kills the whole process group (Metro workers, `nest --watch` children); quitting the app stops everything.

Config lives in `~/.config/forest-jump/config.json`; editor/terminal commands are in ⚙ Settings. Projects added under the old name (`~/.config/env-control/`) are copied over on first start.

## Layout

- `src/main/` — `worktrees.ts` (git worktree parsing/status), `process-manager.ts` (pty runs, group kill, readiness), `ports.ts`, `detect.ts`, `config.ts`, `ipc.ts`
- `src/preload/` — typed `window.api`
- `src/renderer/` — React UI (sidebar, worktree list, xterm log panel, quick switcher)
- `src/shared/types.ts` — types shared by both sides
