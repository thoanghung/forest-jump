import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import type { RunInfo, RunKind } from '../shared/types'
import { isPortListening } from './ports'

const MAX_LOG = 512 * 1024
const STOP_GRACE_MS = 5000

export interface StartOptions {
  id: string
  projectId: string
  worktreePath: string
  label: string
  kind: RunKind
  command: string
  port: number | null
  env: Record<string, string>
  cols?: number
  rows?: number
}

interface Run {
  info: RunInfo
  proc: pty.IPty
  log: string
  /** Total chars ever written; lets the renderer splice a log snapshot with live events. */
  total: number
  readyTimer: NodeJS.Timeout | null
  stopping: Promise<void> | null
  exited: Promise<void>
  opts: StartOptions
}

/** Environment for child processes: the user's env minus what Electron/electron-vite injects. */
export function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('ELECTRON_') || k === 'NODE_ENV' || k === 'NODE_OPTIONS' || k.startsWith('VITE_')) continue
    env[k] = v
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1', ...extra }
}

function killGroup(pid: number, signal: NodeJS.Signals, groupOnly = false): void {
  try {
    // node-pty makes the child a session leader, so -pid targets the whole process tree
    // (expo -> metro workers, nest --watch -> node app, ...).
    process.kill(-pid, signal)
  } catch {
    if (groupOnly) return
    try {
      process.kill(pid, signal)
    } catch {
      /* already gone */
    }
  }
}

export class ProcessManager extends EventEmitter {
  private runs = new Map<string, Run>()
  private pending = new Map<string, { data: string; end: number }>()
  private flushTimer: NodeJS.Timeout | null = null

  list(): RunInfo[] {
    return [...this.runs.values()].map((r) => r.info)
  }

  get(id: string): RunInfo | undefined {
    return this.runs.get(id)?.info
  }

  isActive(id: string): boolean {
    const s = this.runs.get(id)?.info.status
    return s === 'starting' || s === 'running'
  }

  /** Ports held by runs that are still alive. */
  reservedPorts(): Set<number> {
    const set = new Set<number>()
    for (const r of this.runs.values()) {
      if (r.info.port != null && (r.info.status === 'starting' || r.info.status === 'running')) set.add(r.info.port)
    }
    return set
  }

  log(id: string): { text: string; end: number } {
    const r = this.runs.get(id)
    return r ? { text: r.log, end: r.total } : { text: '', end: 0 }
  }

  options(id: string): StartOptions | undefined {
    return this.runs.get(id)?.opts
  }

  start(opts: StartOptions): RunInfo {
    if (this.isActive(opts.id)) throw new Error('Already running in this worktree')
    this.clear(opts.id)

    const shell = process.env.SHELL || '/bin/bash'
    // Interactive login shell so nvm/fnm/asdf/pnpm from ~/.zshrc / ~/.bashrc are on PATH,
    // even when the app is launched from a desktop icon.
    const proc = pty.spawn(shell, ['-ilc', opts.command], {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.worktreePath,
      env: childEnv(opts.env)
    })

    const info: RunInfo = {
      id: opts.id,
      projectId: opts.projectId,
      worktreePath: opts.worktreePath,
      label: opts.label,
      kind: opts.kind,
      command: opts.command,
      port: opts.port,
      pid: proc.pid,
      status: opts.port == null ? 'running' : 'starting',
      exitCode: null,
      startedAt: Date.now()
    }

    let resolveExit!: () => void
    const exited = new Promise<void>((r) => (resolveExit = r))
    const banner = `\x1b[2m$ ${opts.command}${opts.port != null ? `   (port ${opts.port})` : ''}\x1b[0m\r\n`
    const run: Run = { info, proc, log: '', total: 0, readyTimer: null, stopping: null, exited, opts }
    this.runs.set(opts.id, run)
    const append = (data: string): void => {
      run.log += data
      run.total += data.length
      if (run.log.length > MAX_LOG) run.log = run.log.slice(run.log.length - MAX_LOG)
      this.queueData(opts.id, data, run.total)
    }
    append(banner)

    proc.onData(append)

    proc.onExit(({ exitCode, signal }) => {
      if (run.readyTimer) clearInterval(run.readyTimer)
      run.readyTimer = null
      // Make sure nothing in the group outlives the shell. Group-only: the bare pid may
      // already belong to an unrelated process.
      killGroup(info.pid, 'SIGKILL', true)
      info.exitCode = exitCode
      info.status = run.stopping || exitCode === 0 ? 'exited' : 'crashed'
      const msg = `\r\n\x1b[2m[process exited${signal ? ` by signal ${signal}` : ` with code ${exitCode}`}]\x1b[0m\r\n`
      append(msg)
      this.flush()
      this.emit('update', { ...info })
      resolveExit()
      // Stopped (or finished cleanly) → drop the run and its log tab. Crashed runs stay so the
      // error output can still be read.
      if (info.status === 'exited' && this.runs.get(opts.id) === run) this.clear(opts.id)
    })

    if (opts.port != null) {
      const port = opts.port
      run.readyTimer = setInterval(async () => {
        if (info.status !== 'starting') return
        if (await isPortListening(port)) {
          if (info.status !== 'starting') return
          info.status = 'running'
          if (run.readyTimer) clearInterval(run.readyTimer)
          run.readyTimer = null
          this.emit('update', { ...info })
        }
      }, 1000)
    }

    this.emit('update', { ...info })
    return { ...info }
  }

  stop(id: string): Promise<void> {
    const run = this.runs.get(id)
    if (!run || !this.isActive(id)) return Promise.resolve()
    if (run.stopping) return run.stopping
    killGroup(run.info.pid, 'SIGTERM')
    const timer = setTimeout(() => killGroup(run.info.pid, 'SIGKILL'), STOP_GRACE_MS)
    run.stopping = run.exited.then(() => clearTimeout(timer))
    return run.stopping
  }

  /** Remove a finished run (and its log). */
  clear(id: string): void {
    const run = this.runs.get(id)
    if (!run || this.isActive(id)) return
    this.runs.delete(id)
    this.emit('removed', id)
  }

  write(id: string, data: string): void {
    const run = this.runs.get(id)
    if (run && this.isActive(id)) run.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const run = this.runs.get(id)
    if (!run || !this.isActive(id) || cols < 2 || rows < 2) return
    try {
      run.proc.resize(Math.floor(cols), Math.floor(rows))
    } catch {
      /* pty may have just exited */
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)))
  }

  /** Synchronous last-resort cleanup (process 'exit'). */
  killAllSync(): void {
    for (const r of this.runs.values()) {
      if (r.info.status === 'starting' || r.info.status === 'running') killGroup(r.info.pid, 'SIGKILL')
    }
  }

  // Batch pty output into ~60 IPC messages/sec instead of one per chunk.
  private queueData(id: string, data: string, end: number): void {
    const prev = this.pending.get(id)
    this.pending.set(id, { data: (prev?.data ?? '') + data, end })
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 16)
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const [id, p] of this.pending) this.emit('data', id, p.data, p.end)
    this.pending.clear()
  }
}
