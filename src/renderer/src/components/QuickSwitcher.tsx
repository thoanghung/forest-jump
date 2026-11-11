import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, RunInfo, WorktreeList } from '@shared/types'
import { isActive, prettyPath } from '../util'

interface Props {
  projects: Project[]
  lists: Record<string, WorktreeList>
  runs: Record<string, RunInfo>
  onPick: (projectId: string, path: string) => void
  onClose: () => void
}

export default function QuickSwitcher({ projects, lists, runs, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const all = projects.flatMap((p) =>
      (lists[p.id]?.worktrees ?? [])
        .filter((w) => w.exists)
        .map((w) => ({
          project: p,
          wt: w,
          hay: `${p.name} ${w.branch ?? ''} ${w.path}`.toLowerCase()
        }))
    )
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter((i) => terms.every((t) => i.hay.includes(t)))
  }, [projects, lists, q])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && items[idx]) {
      onPick(items[idx].project.id, items[idx].wt.path)
    }
  }

  return (
    <div className="modal-backdrop top" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Type a branch or project… Enter runs it (or shows its logs if running)"
        />
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="muted pad">No matching worktrees</div>}
          {items.map((i, n) => {
            const run = runs[i.wt.path]
            return (
              <div
                key={i.wt.path}
                className={`palette-item ${n === idx ? 'on' : ''}`}
                onMouseEnter={() => setIdx(n)}
                onClick={() => onPick(i.project.id, i.wt.path)}
              >
                <span className={`dot ${run ? run.status : 'idle'}`} />
                <span className="branch">{i.wt.branch ?? i.wt.head.slice(0, 7)}</span>
                <span className="muted">{i.project.name}</span>
                <span className="muted mono small grow">{prettyPath(i.wt.path)}</span>
                <span className="muted small">{isActive(run) ? 'show logs' : 'run'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
