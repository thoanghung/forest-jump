import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Worktree } from '../shared/types'

const exec = promisify(execFile)

export interface RawWorktree {
  path: string
  head: string
  branch: string | null
  bare: boolean
  locked: boolean
  prunable: boolean
}

/** Parse `git worktree list --porcelain`. The first entry is the main worktree. */
export function parsePorcelain(text: string): RawWorktree[] {
  const result: RawWorktree[] = []
  let cur: RawWorktree | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), head: '', branch: null, bare: false, locked: false, prunable: false }
      result.push(cur)
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      cur.prunable = true
    }
  }
  return result
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Absolute path of the shared .git directory (works from any worktree). */
export async function gitCommonDir(repoPath: string): Promise<string> {
  const out = (await git(repoPath, ['rev-parse', '--git-common-dir'])).trim()
  return resolve(repoPath, out)
}

/** `.env*` files in a directory (top level only). */
export function envFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => /^\.env/.test(f) && statSync(join(dir, f)).isFile())
  } catch {
    return []
  }
}

async function status(path: string): Promise<{ dirty: boolean; ahead: number; behind: number }> {
  let dirty = false
  let ahead = 0
  let behind = 0
  try {
    dirty = (await git(path, ['status', '--porcelain', '--untracked-files=normal'])).trim().length > 0
  } catch {
    /* ignore */
  }
  try {
    const out = (await git(path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])).trim()
    const [b, a] = out.split(/\s+/).map(Number)
    behind = b || 0
    ahead = a || 0
  } catch {
    /* no upstream */
  }
  return { dirty, ahead, behind }
}

export async function listWorktrees(repoPath: string): Promise<Worktree[]> {
  const raw = parsePorcelain(await git(repoPath, ['worktree', 'list', '--porcelain'])).filter((w) => !w.bare)
  const main = raw[0]
  const mainEnv = main ? envFiles(main.path) : []

  return Promise.all(
    raw.map(async (w, i): Promise<Worktree> => {
      const exists = existsSync(w.path)
      const st = exists ? await status(w.path) : { dirty: false, ahead: 0, behind: 0 }
      const isMain = i === 0
      const here = exists ? new Set(envFiles(w.path)) : new Set<string>()
      return {
        path: w.path,
        branch: w.branch,
        head: w.head,
        isMain,
        locked: w.locked,
        prunable: w.prunable,
        exists,
        ...st,
        missingEnv: isMain || !exists ? [] : mainEnv.filter((f) => !here.has(f)),
        missingNodeModules:
          exists && existsSync(join(w.path, 'package.json')) && !existsSync(join(w.path, 'node_modules'))
      }
    })
  )
}
