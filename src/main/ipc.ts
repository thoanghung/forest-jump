import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { EnvFileList, Project, RunInfo, Settings, Worktree, WorktreeList } from '../shared/types'
import type { ConfigStore } from './config'
import { copyEnvFiles } from './bootstrap'
import { detectPackageManager, detectProject, installCommand } from './detect'
import { loadWorktreeEnv, portFromEnv, safeEnvName } from './env-files'
import { launch } from './launch'
import { isPortFree } from './ports'
import type { ProcessManager } from './process-manager'
import { envFiles, gitCommonDir, listWorktrees } from './worktrees'

export function registerIpc(win: () => BrowserWindow | null, config: ConfigStore, pm: ProcessManager): () => void {
  const send = (channel: string, ...args: unknown[]): void => {
    const w = win()
    if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
  }

  pm.on('data', (id: string, data: string, end: number) => send('run:data', id, data, end))
  pm.on('update', (run: RunInfo) => send('run:update', run))
  pm.on('removed', (id: string) => send('run:removed', id))

  // ---- worktree watching: notify the renderer when worktrees are added/removed/switch branch
  const watchers = new Map<string, FSWatcher>()
  const timers = new Map<string, NodeJS.Timeout>()
  const notify = (projectId: string): void => {
    clearTimeout(timers.get(projectId))
    timers.set(projectId, setTimeout(() => send('worktrees:changed', projectId), 700))
  }
  const syncWatchers = async (): Promise<void> => {
    const projects = config.get().projects
    for (const [id, w] of watchers) {
      if (!projects.some((p) => p.id === id)) {
        await w.close()
        watchers.delete(id)
      }
    }
    for (const p of projects) {
      if (watchers.has(p.id)) continue
      try {
        const common = await gitCommonDir(p.repoPath)
        const w = watch(common, {
          ignoreInitial: true,
          depth: 2,
          // Only worktree dirs (add/remove), their HEAD (branch switch) and the main HEAD.
          ignored: (path: string) => {
            const rel = relative(common, path)
            if (rel === '') return false
            const parts = rel.split(sep)
            if (parts[0] === 'worktrees') return parts.length > 2 && !(parts.length === 3 && parts[2] === 'HEAD')
            return parts[0] !== 'HEAD'
          }
        })
        w.on('all', () => notify(p.id))
        w.on('error', () => undefined)
        watchers.set(p.id, w)
      } catch {
        /* not a git repo anymore; listWorktrees will report it */
      }
    }
  }
  void syncWatchers()

  // ---- config
  ipcMain.handle('config:get', () => config.get())
  ipcMain.handle('config:saveProject', async (_e, p: Project) => {
    const c = config.upsertProject(p)
    await syncWatchers()
    return c
  })
  ipcMain.handle('config:removeProject', async (_e, id: string) => {
    const c = config.removeProject(id)
    await syncWatchers()
    return c
  })
  ipcMain.handle('config:saveSettings', (_e, s: Settings) => config.setSettings(s))
  ipcMain.handle('dialog:pickFolder', async () => {
    const w = win()
    const opts = { properties: ['openDirectory' as const] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('project:detect', async (_e, path: string) => {
    // Validate it's a git repo up front so the dialog can show a useful error.
    await gitCommonDir(path)
    return detectProject(path)
  })

  // ---- worktrees
  ipcMain.handle('worktrees:list', async (_e, projectId: string): Promise<WorktreeList> => {
    try {
      const p = config.project(projectId)
      return { projectId, worktrees: await listWorktrees(p.repoPath), error: null }
    } catch (err) {
      return { projectId, worktrees: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** Resolve a worktree of a configured project; rejects any other path. */
  const resolveWorktree = async (
    projectId: string,
    path: string
  ): Promise<{ project: Project; wt: Worktree; main: Worktree | undefined }> => {
    const project = config.project(projectId)
    const wts = await listWorktrees(project.repoPath)
    const wt = wts.find((w) => w.path === path)
    if (!wt || !wt.exists) throw new Error('Worktree not found')
    return { project, wt, main: wts.find((w) => w.isMain) }
  }

  // ---- runs
  const label = (path: string, branch: string | null): string => branch ?? path.split(sep).pop() ?? path

  const startDev = async (projectId: string, worktreePath: string): Promise<RunInfo> => {
    const { project: p, wt } = await resolveWorktree(projectId, worktreePath)
    // Settings and port come from the worktree's own .env files.
    const env = loadWorktreeEnv(worktreePath)
    const found = portFromEnv(env)
    if (found) {
      const holder = pm.list().find((r) => r.port === found.port && pm.isActive(r.id) && r.id !== worktreePath)
      if (holder || !(await isPortFree(found.port))) {
        throw new Error(
          `Port ${found.port} (${found.key} in .env) is already in use${holder ? ` by ${holder.label}` : ''}. ` +
            `Change ${found.key} in this worktree's .env.`
        )
      }
    }
    return pm.start({
      id: worktreePath,
      projectId,
      worktreePath,
      label: `${p.name} · ${label(worktreePath, wt.branch)}`,
      kind: 'dev',
      command: p.command,
      port: found?.port ?? null,
      env
    })
  }

  ipcMain.handle('run:list', () => pm.list())
  ipcMain.handle('run:log', (_e, id: string) => pm.log(id))
  ipcMain.handle('run:startDev', (_e, projectId: string, path: string) => startDev(projectId, path))
  ipcMain.handle('run:setup', async (_e, projectId: string, path: string) => {
    const { project: p, wt, main } = await resolveWorktree(projectId, path)
    const copied = main ? copyEnvFiles(main.path, wt.path, wt.missingEnv) : []
    if (copied.length) send('worktrees:changed', projectId)
    if (!wt.missingNodeModules) return null
    const note = copied.length ? `echo "Copied ${copied.join(', ')} from main worktree"; ` : ''
    return pm.start({
      id: path,
      projectId,
      worktreePath: path,
      label: `${p.name} · ${label(path, wt.branch)} (setup)`,
      kind: 'setup',
      command: `${note}${installCommand(detectPackageManager(path))}`,
      port: null,
      env: {}
    })
  })

  // ---- .env files of a worktree
  const envPath = (dir: string, name: string): string => {
    if (!safeEnvName(name)) throw new Error(`Invalid env file name "${name}" (must start with .env)`)
    return join(dir, name)
  }
  const sortEnv = (names: string[]): string[] =>
    [...names].sort((a, b) => (a === '.env' ? -1 : b === '.env' ? 1 : a.localeCompare(b)))

  ipcMain.handle('env:list', async (_e, projectId: string, path: string): Promise<EnvFileList> => {
    const { wt, main } = await resolveWorktree(projectId, path)
    const files = envFiles(wt.path).filter(safeEnvName)
    const missingFromMain = main && main.path !== wt.path ? envFiles(main.path).filter((f) => safeEnvName(f) && !files.includes(f)) : []
    return { files: sortEnv(files), missingFromMain: sortEnv(missingFromMain) }
  })
  ipcMain.handle('env:read', async (_e, projectId: string, path: string, name: string) => {
    const { wt } = await resolveWorktree(projectId, path)
    const file = envPath(wt.path, name)
    return { name, content: existsSync(file) ? readFileSync(file, 'utf8') : '' }
  })
  ipcMain.handle('env:write', async (_e, projectId: string, path: string, name: string, content: string) => {
    const { wt } = await resolveWorktree(projectId, path)
    const file = envPath(wt.path, name)
    const tmp = `${file}.forest-jump-tmp`
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
    send('worktrees:changed', projectId)
  })
  ipcMain.handle('env:copyFromMain', async (_e, projectId: string, path: string, name: string) => {
    const { wt, main } = await resolveWorktree(projectId, path)
    envPath(wt.path, name)
    if (!main) throw new Error('No main worktree')
    if (copyEnvFiles(main.path, wt.path, [name]).length === 0) throw new Error(`${name} already exists or is missing in main`)
    send('worktrees:changed', projectId)
  })

  ipcMain.handle('run:stop', (_e, id: string) => pm.stop(id))
  ipcMain.handle('run:restart', async (_e, id: string) => {
    const opts = pm.options(id)
    if (!opts) throw new Error('Unknown run')
    await pm.stop(id)
    if (opts.kind === 'dev') return startDev(opts.projectId, opts.worktreePath)
    return pm.start(opts)
  })
  ipcMain.handle('run:clear', (_e, id: string) => pm.clear(id))
  ipcMain.on('run:write', (_e, id: string, data: string) => pm.write(id, data))
  ipcMain.on('run:resize', (_e, id: string, cols: number, rows: number) => pm.resize(id, cols, rows))

  // ---- open helpers
  // `{path}` in these commands is replaced by the worktree path; without it the editor gets the
  // path appended and the terminal just starts with cwd = worktree.
  ipcMain.handle('open:editor', (_e, path: string) => launch(config.get().settings.editorCommand, path, true))
  ipcMain.handle('open:terminal', (_e, path: string) => launch(config.get().settings.terminalCommand, path, false))
  ipcMain.handle('open:folder', async (_e, path: string) => {
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })
  ipcMain.handle('open:url', (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs')
    return shell.openExternal(url)
  })

  return () => {
    for (const w of watchers.values()) void w.close()
  }
}
