import type { RunInfo, RunStatus } from '@shared/types'

export const isActive = (r: RunInfo | undefined): boolean => r?.status === 'starting' || r?.status === 'running'

export const statusLabel: Record<RunStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  exited: 'Stopped',
  crashed: 'Crashed'
}

/** Show paths relative to the home dir. */
export function prettyPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, '~')
}

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
