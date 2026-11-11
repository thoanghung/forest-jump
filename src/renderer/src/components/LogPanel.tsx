import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { RunInfo } from '@shared/types'
import type { Actions } from '../App'
import { isActive, statusLabel } from '../util'

interface Props {
  runs: RunInfo[]
  active: string | null
  onActivate: (id: string | null) => void
  actions: Actions
}

const MIN_H = 120

export default function LogPanel({ runs, active, onActivate, actions }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const writeRef = useRef<(data: string, end: number) => void>(() => undefined)
  // Which run the terminal is showing and how far into its log we are.
  const viewRef = useRef<{ id: string | null; end: number; loading: boolean; queue: [string, number][] }>({
    id: null,
    end: 0,
    loading: false,
    queue: []
  })
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.42))
  const [collapsed, setCollapsed] = useState(false)

  const current = runs.find((r) => r.id === active) ?? null

  // ---- create the terminal once
  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      scrollback: 10000,
      convertEol: false,
      cursorBlink: false,
      theme: { background: '#0e1013', foreground: '#d7dae0', selectionBackground: '#3a4a66' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    termRef.current = term
    fitRef.current = fit

    // Keystrokes go to the running process (Expo: r = reload, a = android, ...).
    const sub = term.onData((d) => {
      const id = viewRef.current.id
      if (id) window.api.writeRun(id, d)
    })

    const write = (data: string, end: number): void => {
      const v = viewRef.current
      if (end <= v.end) return
      const start = end - data.length
      term.write(start >= v.end ? data : data.slice(v.end - start))
      v.end = end
    }
    const off = window.api.onRunData((id, data, end) => {
      const v = viewRef.current
      if (id !== v.id) return
      if (v.loading) v.queue.push([data, end])
      else write(data, end)
    })
    writeRef.current = write

    return () => {
      off()
      sub.dispose()
      term.dispose()
    }
  }, [])

  // ---- (re)load when the shown run changes or is restarted
  const runKey = current ? `${current.id}@${current.startedAt}` : null
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const v = viewRef.current
    term.reset()
    v.id = current?.id ?? null
    v.end = 0
    v.queue = []
    if (!current) return
    v.loading = true
    const id = current.id
    void window.api.getLog(id).then((snap) => {
      if (viewRef.current.id !== id) return
      term.write(snap.text)
      v.end = snap.end
      v.loading = false
      for (const [d, e] of v.queue) writeRef.current(d, e)
      v.queue = []
      fitAndResize()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  const fitAndResize = (): void => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit || collapsed) return
    try {
      fit.fit()
    } catch {
      return
    }
    const id = viewRef.current.id
    if (id) window.api.resizeRun(id, term.cols, term.rows)
  }

  useEffect(() => {
    const ro = new ResizeObserver(() => fitAndResize())
    if (hostRef.current) ro.observe(hostRef.current)
    return () => ro.disconnect()
  })

  // Auto-select a run if none is shown.
  useEffect(() => {
    if (!active && runs.length) onActivate(runs[runs.length - 1].id)
  }, [active, runs, onActivate])

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const move = (ev: MouseEvent): void =>
      setHeight(Math.max(MIN_H, Math.min(window.innerHeight - 150, startH + (startY - ev.clientY))))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const url = current?.port != null ? `http://localhost:${current.port}` : null
  const running = isActive(current ?? undefined)

  return (
    <section className={`log-panel ${collapsed ? 'collapsed' : ''}`} style={{ height: collapsed ? undefined : height }}>
      {!collapsed && <div className="drag" onMouseDown={startDrag} />}
      <div className="log-bar">
        <div className="tabs">
          {runs.length === 0 && <span className="muted small pad-x">No runs yet — click ▶ Run on a worktree.</span>}
          {runs.map((r) => (
            <div
              key={r.id}
              className={`tab ${r.id === active ? 'on' : ''}`}
              onClick={() => {
                onActivate(r.id)
                setCollapsed(false)
              }}
              title={`${r.command}\n${r.worktreePath}`}
            >
              <span className={`dot ${r.status}`} />
              <span>{r.label}</span>
              {r.port != null && <span className="muted mono">:{r.port}</span>}
              {!isActive(r) && (
                <button
                  className="x"
                  title="Close"
                  onClick={(e) => {
                    e.stopPropagation()
                    void actions.clear(r.id)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="row-actions">
          {current && (
            <span className={`muted small ${current.status}`}>
              {statusLabel[current.status]}
              {current.exitCode != null && current.status === 'crashed' ? ` (code ${current.exitCode})` : ''}
            </span>
          )}
          {url && running && <button onClick={() => actions.openUrl(url)}>Open :{current!.port}</button>}
          {current && running && <button className="danger" onClick={() => actions.stop(current.id)}>■ Stop</button>}
          {current && current.kind === 'dev' && <button onClick={() => actions.restart(current.id)}>↻ Restart</button>}
          {current && <button onClick={() => termRef.current?.clear()}>Clear</button>}
          <button className="ghost" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '▴' : '▾'}
          </button>
        </div>
      </div>
      <div className="term-host" ref={hostRef} style={{ display: collapsed ? 'none' : undefined }} />
    </section>
  )
}
