import type { Project, RunInfo, Worktree, WorktreeList } from '@shared/types'
import type { Actions } from '../App'
import { isActive, prettyPath, statusLabel } from '../util'

interface Props {
  project: Project
  list: WorktreeList | undefined
  runs: Record<string, RunInfo>
  busy: Set<string>
  activeLog: string | null
  actions: Actions
  onRefresh: () => void
  onEdit: () => void
}

export default function WorktreeTable({ project, list, runs, busy, activeLog, actions, onRefresh, onEdit }: Props) {
  const worktrees = list?.worktrees ?? []
  return (
    <div className="worktrees">
      <header className="project-header">
        <div>
          <h1>{project.name}</h1>
          <div className="muted mono">
            {prettyPath(project.repoPath)} · <span title="Dev command">{project.command}</span>
          </div>
        </div>
        <div className="row-actions">
          <button onClick={onRefresh}>↻ Refresh</button>
          <button onClick={onEdit}>Edit project</button>
        </div>
      </header>

      {list?.error && <div className="error-box">{list.error}</div>}
      {!list && <div className="muted pad">Loading worktrees…</div>}

      <div className="wt-list">
        {worktrees.map((wt) => (
          <WorktreeRow
            key={wt.path}
            project={project}
            wt={wt}
            run={runs[wt.path]}
            busy={busy.has(wt.path)}
            logShown={activeLog === wt.path}
            actions={actions}
          />
        ))}
      </div>
    </div>
  )
}

function WorktreeRow({
  project,
  wt,
  run,
  busy,
  logShown,
  actions
}: {
  project: Project
  wt: Worktree
  run: RunInfo | undefined
  busy: boolean
  logShown: boolean
  actions: Actions
}) {
  const active = isActive(run)
  const needsSetup = wt.missingEnv.length > 0 || wt.missingNodeModules
  const status = run ? run.status : 'idle'
  const url = run?.port != null ? `http://localhost:${run.port}` : null

  return (
    <div className={`wt ${active ? 'active' : ''} ${logShown ? 'log-shown' : ''}`}>
      <span className={`dot ${status}`} title={run ? statusLabel[run.status] : 'Not running'} />
      <div className="wt-main" onClick={() => run && actions.showLog(run.id)}>
        <div className="wt-title">
          <span className="branch">{wt.branch ?? `detached @ ${wt.head.slice(0, 7)}`}</span>
          {wt.isMain && <span className="badge">main</span>}
          {wt.dirty && <span className="badge warn" title="Uncommitted changes">modified</span>}
          {wt.ahead > 0 && <span className="badge" title="Commits ahead of upstream">↑{wt.ahead}</span>}
          {wt.behind > 0 && <span className="badge" title="Commits behind upstream">↓{wt.behind}</span>}
          {wt.locked && <span className="badge">locked</span>}
          {!wt.exists && <span className="badge danger">missing on disk</span>}
          {run?.kind === 'setup' && active && <span className="badge info">installing…</span>}
        </div>
        <div className="muted mono small">{prettyPath(wt.path)}</div>
        {needsSetup && wt.exists && (
          <div className="setup-hint">
            ⚠ Missing{' '}
            {[
              wt.missingEnv.length ? wt.missingEnv.join(', ') : null,
              wt.missingNodeModules ? 'node_modules' : null
            ]
              .filter(Boolean)
              .join(' and ')}
            <button className="link" disabled={busy || active} onClick={() => actions.setup(project.id, wt.path)}>
              Set up
            </button>
          </div>
        )}
      </div>

      <div className="wt-port">
        {url && active && (
          <button className="link mono" onClick={() => actions.openUrl(url)} title="Open in browser">
            :{run!.port}
          </button>
        )}
        {run && !active && <span className={`muted small ${run.status}`}>{statusLabel[run.status]}</span>}
      </div>

      <div className="row-actions">
        {active ? (
          <>
            <button onClick={() => actions.showLog(run!.id)} className={logShown ? 'on' : ''}>
              Logs
            </button>
            {run!.kind === 'dev' && (
              <button disabled={busy} onClick={() => actions.restart(run!.id)}>
                ↻
              </button>
            )}
            <button className="danger" disabled={busy} onClick={() => actions.stop(run!.id)}>
              ■ Stop
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy || !wt.exists} onClick={() => actions.start(project.id, wt.path)}>
            ▶ Run
          </button>
        )}
        <button
          className={wt.missingEnv.length ? 'ghost warn' : 'ghost'}
          title="View / edit .env files"
          disabled={!wt.exists}
          onClick={() => actions.editEnv(project.id, wt.path)}
        >
          .env
        </button>
        <button className="ghost" title="Open in editor" onClick={() => actions.openEditor(wt.path)}>
          Code
        </button>
        <button className="ghost" title="Open terminal here" onClick={() => actions.openTerminal(wt.path)}>
          Term
        </button>
        <button className="ghost" title="Open folder" onClick={() => actions.openFolder(wt.path)}>
          Folder
        </button>
      </div>
    </div>
  )
}
