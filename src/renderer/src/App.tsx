import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppConfig, Project, RunInfo, WorktreeList } from '@shared/types'
import Sidebar from './components/Sidebar'
import WorktreeTable from './components/WorktreeTable'
import LogPanel from './components/LogPanel'
import ProjectDialog from './components/ProjectDialog'
import SettingsDialog from './components/SettingsDialog'
import QuickSwitcher from './components/QuickSwitcher'
import EnvEditor from './components/EnvEditor'
import { isActive } from './util'

const api = window.api

type Dialog =
  | { kind: 'project'; project: Project | null }
  | { kind: 'settings' }
  | { kind: 'env'; projectId: string; worktreePath: string }
  | null

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [lists, setLists] = useState<Record<string, WorktreeList>>({})
  const [runs, setRuns] = useState<Record<string, RunInfo>>({})
  const [activeLog, setActiveLog] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [palette, setPalette] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const configRef = useRef<AppConfig | null>(null)
  configRef.current = config

  const showError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 6000)
  }, [])

  const refresh = useCallback(async (projectId: string) => {
    const list = await api.listWorktrees(projectId)
    setLists((l) => ({ ...l, [projectId]: list }))
  }, [])

  const refreshAll = useCallback(() => {
    for (const p of configRef.current?.projects ?? []) void refresh(p.id)
  }, [refresh])

  // ---- initial load + subscriptions
  useEffect(() => {
    void api.getConfig().then((c) => {
      setConfig(c)
      configRef.current = c
      setSelected((s) => s ?? c.projects[0]?.id ?? null)
      for (const p of c.projects) void refresh(p.id)
    })
    void api.listRuns().then((rs) => setRuns(Object.fromEntries(rs.map((r) => [r.id, r]))))

    const offs = [
      api.onRunUpdate((run) => {
        setRuns((r) => ({ ...r, [run.id]: run }))
        // A finished setup (install) changes the worktree's warnings.
        if (run.kind === 'setup' && (run.status === 'exited' || run.status === 'crashed')) void refresh(run.projectId)
      }),
      api.onRunRemoved((id) =>
        setRuns((r) => {
          const n = { ...r }
          delete n[id]
          return n
        })
      ),
      api.onWorktreesChanged((projectId) => void refresh(projectId))
    ]
    const onFocus = (): void => refreshAll()
    window.addEventListener('focus', onFocus)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, refreshAll])

  // ---- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ---- actions
  const withBusy = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy((b) => new Set(b).add(key))
      try {
        return await fn()
      } catch (err) {
        showError(err)
        return undefined
      } finally {
        setBusy((b) => {
          const n = new Set(b)
          n.delete(key)
          return n
        })
      }
    },
    [showError]
  )

  const actions = useMemo(
    () => ({
      start: (projectId: string, path: string) =>
        withBusy(path, async () => {
          try {
            const run = await api.startDev(projectId, path)
            setRuns((r) => ({ ...r, [run.id]: run }))
            setActiveLog(run.id)
          } catch (err) {
            // Port taken → open this worktree's .env so the port can be changed right away.
            if (err instanceof Error && /already in use/.test(err.message)) setDialog({ kind: 'env', projectId, worktreePath: path })
            throw err
          }
        }),
      editEnv: (projectId: string, path: string) => setDialog({ kind: 'env', projectId, worktreePath: path }),
      setup: (projectId: string, path: string) =>
        withBusy(path, async () => {
          const run = await api.setupWorktree(projectId, path)
          if (run) {
            setRuns((r) => ({ ...r, [run.id]: run }))
            setActiveLog(run.id)
          }
          await refresh(projectId)
        }),
      stop: (id: string) => withBusy(id, () => api.stopRun(id)),
      restart: (id: string) =>
        withBusy(id, async () => {
          const run = await api.restartRun(id)
          setRuns((r) => ({ ...r, [run.id]: run }))
          setActiveLog(run.id)
        }),
      clear: (id: string) =>
        withBusy(id, async () => {
          await api.clearRun(id)
          setActiveLog((a) => (a === id ? null : a))
        }),
      showLog: (id: string) => setActiveLog(id),
      openEditor: (path: string) => api.openEditor(path).catch(showError),
      openTerminal: (path: string) => api.openTerminal(path).catch(showError),
      openFolder: (path: string) => api.openFolder(path).catch(showError),
      openUrl: (url: string) => api.openUrl(url).catch(showError)
    }),
    [withBusy, refresh, showError]
  )

  const saveProject = async (p: Project): Promise<void> => {
    const c = await api.saveProject(p)
    setConfig(c)
    configRef.current = c
    setSelected(p.id)
    setDialog(null)
    await refresh(p.id)
  }

  const removeProject = async (id: string): Promise<void> => {
    const c = await api.removeProject(id)
    setConfig(c)
    configRef.current = c
    setSelected((s) => (s === id ? (c.projects[0]?.id ?? null) : s))
    setDialog(null)
  }

  if (!config) return <div className="loading">Loading…</div>

  const project = config.projects.find((p) => p.id === selected) ?? null
  const runList = Object.values(runs).sort((a, b) => a.startedAt - b.startedAt)

  return (
    <div className="app">
      <Sidebar
        projects={config.projects}
        selected={selected}
        runs={runList}
        onSelect={setSelected}
        onAdd={() => setDialog({ kind: 'project', project: null })}
        onSettings={() => setDialog({ kind: 'settings' })}
        onPalette={() => setPalette(true)}
      />
      <main className="main">
        <section className="content">
          {project ? (
            <WorktreeTable
              project={project}
              list={lists[project.id]}
              runs={runs}
              busy={busy}
              activeLog={activeLog}
              actions={actions}
              onRefresh={() => void refresh(project.id)}
              onEdit={() => setDialog({ kind: 'project', project })}
            />
          ) : (
            <div className="empty">
              <h2>No projects yet</h2>
              <p>Add a git repo. Its worktrees are listed automatically, and you can start the dev env of any of them.</p>
              <button className="primary" onClick={() => setDialog({ kind: 'project', project: null })}>
                + Add project
              </button>
            </div>
          )}
        </section>
        <LogPanel runs={runList} active={activeLog} onActivate={setActiveLog} actions={actions} />
      </main>

      {dialog?.kind === 'project' && (
        <ProjectDialog
          project={dialog.project}
          onSave={saveProject}
          onRemove={removeProject}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'settings' && (
        <SettingsDialog
          settings={config.settings}
          onSave={async (s) => {
            setConfig(await api.saveSettings(s))
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'env' && (
        <EnvEditor
          projectId={dialog.projectId}
          worktreePath={dialog.worktreePath}
          title={
            lists[dialog.projectId]?.worktrees.find((w) => w.path === dialog.worktreePath)?.branch ??
            dialog.worktreePath.split('/').pop()!
          }
          running={isActive(runs[dialog.worktreePath]) && runs[dialog.worktreePath]?.kind === 'dev'}
          onRestart={() => void actions.restart(dialog.worktreePath)}
          onClose={() => setDialog(null)}
        />
      )}
      {palette && (
        <QuickSwitcher
          projects={config.projects}
          lists={lists}
          runs={runs}
          onClose={() => setPalette(false)}
          onPick={(projectId, path) => {
            setPalette(false)
            setSelected(projectId)
            const r = runs[path]
            if (r && (r.status === 'starting' || r.status === 'running')) setActiveLog(path)
            else void actions.start(projectId, path)
          }}
        />
      )}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}

export type Actions = {
  start: (projectId: string, path: string) => Promise<void | undefined>
  setup: (projectId: string, path: string) => Promise<void | undefined>
  stop: (id: string) => Promise<void | undefined>
  restart: (id: string) => Promise<void | undefined>
  clear: (id: string) => Promise<void | undefined>
  editEnv: (projectId: string, path: string) => void
  showLog: (id: string) => void
  openEditor: (path: string) => Promise<void>
  openTerminal: (path: string) => Promise<void>
  openFolder: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
}
