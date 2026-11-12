import { spawn } from 'node:child_process'

/** Split a command line into argv, honouring "double" and 'single' quotes. No shell expansion. */
export function splitArgs(commandLine: string): string[] {
  const args: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let inArg = false
  for (const ch of commandLine.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inArg = true
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(cur)
      cur = ''
      inArg = false
    } else {
      cur += ch
      inArg = true
    }
  }
  if (quote) throw new Error(`Unclosed ${quote} in command: ${commandLine}`)
  if (inArg) args.push(cur)
  return args
}

/**
 * Build argv for an "open in editor/terminal" command. `{path}` is replaced by the worktree path
 * (it stays a single argument, even with spaces). Without `{path}`, `appendPath` decides whether
 * the path is added at the end (editor: yes, terminal: no — it starts with cwd = worktree).
 */
export function buildLaunchArgs(commandLine: string, path: string, appendPath: boolean): string[] {
  const args = splitArgs(commandLine)
  if (args.length === 0) throw new Error('Command is empty — set it in Settings')
  const hasPlaceholder = args.some((a) => a.includes('{path}'))
  const out = args.map((a) => a.split('{path}').join(path))
  if (!hasPlaceholder && appendPath) out.push(path)
  return out
}

/** Start a detached program (no shell) with cwd = the worktree. */
export function launch(commandLine: string, path: string, appendPath: boolean): Promise<void> {
  const [cmd, ...args] = buildLaunchArgs(commandLine, path, appendPath)
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: path, detached: true, stdio: 'ignore' })
    child.once('error', (err) => reject(new Error(`Could not start "${cmd}": ${err.message}`)))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
