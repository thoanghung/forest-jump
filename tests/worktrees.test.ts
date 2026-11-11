import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parsePorcelain, listWorktrees } from '../src/main/worktrees'
import { copyEnvFiles } from '../src/main/bootstrap'

describe('parsePorcelain', () => {
  it('parses main, branch, detached, locked and prunable worktrees', () => {
    const text = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo-feat',
      'HEAD bbbbbbb',
      'branch refs/heads/feature/login',
      'locked agent working',
      '',
      'worktree /repo-detached',
      'HEAD ccccccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')
    const r = parsePorcelain(text)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ path: '/repo', branch: 'main', head: 'aaaaaaa', locked: false })
    expect(r[1]).toMatchObject({ path: '/repo-feat', branch: 'feature/login', locked: true })
    expect(r[2]).toMatchObject({ path: '/repo-detached', branch: null, prunable: true })
  })

  it('handles paths with spaces', () => {
    expect(parsePorcelain('worktree /a b/c\nHEAD x\nbranch refs/heads/m\n')[0].path).toBe('/a b/c')
  })
})

describe('listWorktrees (real git)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forest-jump-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' })

  it('lists worktrees and detects missing .env / node_modules', async () => {
    const main = join(root, 'app')
    mkdirSync(main)
    git(main, 'init', '-q', '-b', 'main')
    writeFileSync(join(main, 'package.json'), '{"name":"app"}')
    writeFileSync(join(main, '.gitignore'), '.env*\nnode_modules\n')
    git(main, 'add', '.')
    git(main, 'commit', '-qm', 'init')
    writeFileSync(join(main, '.env'), 'A=1')
    writeFileSync(join(main, '.env.local'), 'B=2')
    mkdirSync(join(main, 'node_modules'))
    git(main, 'worktree', 'add', '-q', join(root, 'app-feat'), '-b', 'feat')

    const wts = await listWorktrees(main)
    expect(wts.map((w) => w.branch)).toEqual(['main', 'feat'])
    expect(wts[0]).toMatchObject({ isMain: true, missingEnv: [], missingNodeModules: false, dirty: false })
    expect(wts[1].missingEnv.sort()).toEqual(['.env', '.env.local'])
    expect(wts[1].missingNodeModules).toBe(true)

    // works when pointed at a linked worktree too
    expect((await listWorktrees(join(root, 'app-feat'))).length).toBe(2)

    const copied = copyEnvFiles(main, wts[1].path, wts[1].missingEnv)
    expect(copied.sort()).toEqual(['.env', '.env.local'])
    expect(existsSync(join(wts[1].path, '.env'))).toBe(true)
    // never overwrites
    expect(copyEnvFiles(main, wts[1].path, ['.env'])).toEqual([])
    expect((await listWorktrees(main))[1].missingEnv).toEqual([])
  })
})
