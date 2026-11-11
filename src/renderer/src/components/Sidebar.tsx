import type { Project, RunInfo } from '@shared/types'
import { isActive } from '../util'

interface Props {
  projects: Project[]
  selected: string | null
  runs: RunInfo[]
  onSelect: (id: string) => void
  onAdd: () => void
  onSettings: () => void
  onPalette: () => void
}

export default function Sidebar({ projects, selected, runs, onSelect, onAdd, onSettings, onPalette }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">Forest Jump</div>
      <button className="search" onClick={onPalette}>
        <span>Find worktree…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="section-title">Projects</div>
      <nav className="projects">
        {projects.map((p) => {
          const running = runs.filter((r) => r.projectId === p.id && r.kind === 'dev' && isActive(r)).length
          return (
            <button
              key={p.id}
              className={`project ${p.id === selected ? 'selected' : ''}`}
              onClick={() => onSelect(p.id)}
              title={p.repoPath}
            >
              <span className="project-name">{p.name}</span>
              {running > 0 && <span className="pill running">{running}</span>}
            </button>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <button onClick={onAdd}>+ Add project</button>
        <button className="ghost" onClick={onSettings} title="Settings">
          ⚙
        </button>
      </div>
    </aside>
  )
}
