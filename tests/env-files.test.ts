import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadWorktreeEnv, parseDotenv, portFromEnv, safeEnvName } from '../src/main/env-files'

describe('parseDotenv', () => {
  it('handles comments, export, quotes and inline comments', () => {
    const env = parseDotenv(
      [
        '# comment',
        '',
        'PORT=3001',
        'export API_URL=http://localhost:3001/api',
        'QUOTED="hello # not a comment"',
        "SINGLE='a b'",
        'MULTI="line1\\nline2"',
        'INLINE=value # trailing comment',
        'EMPTY=',
        'not a var',
        '1BAD=x'
      ].join('\n')
    )
    expect(env).toEqual({
      PORT: '3001',
      API_URL: 'http://localhost:3001/api',
      QUOTED: 'hello # not a comment',
      SINGLE: 'a b',
      MULTI: 'line1\nline2',
      INLINE: 'value',
      EMPTY: ''
    })
  })
})

describe('loadWorktreeEnv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forest-jump-env-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('later files override earlier ones (.env < .env.development < .env.local < .env.development.local)', () => {
    writeFileSync(join(dir, '.env'), 'A=env\nB=env\nC=env\nD=env')
    writeFileSync(join(dir, '.env.development'), 'B=dev\nC=dev\nD=dev')
    writeFileSync(join(dir, '.env.local'), 'C=local\nD=local')
    writeFileSync(join(dir, '.env.development.local'), 'D=devlocal')
    writeFileSync(join(dir, '.env.production'), 'A=prod')
    expect(loadWorktreeEnv(dir)).toEqual({ A: 'env', B: 'dev', C: 'local', D: 'devlocal' })
  })
})

describe('portFromEnv', () => {
  it('prefers PORT, then RCT_METRO_PORT, ignores invalid values', () => {
    expect(portFromEnv({ RCT_METRO_PORT: '8082', PORT: '3000' })).toEqual({ port: 3000, key: 'PORT' })
    expect(portFromEnv({ RCT_METRO_PORT: '8082' })).toEqual({ port: 8082, key: 'RCT_METRO_PORT' })
    expect(portFromEnv({ PORT: 'abc', APP_PORT: '99999' })).toBeNull()
    expect(portFromEnv({})).toBeNull()
  })
})

describe('safeEnvName', () => {
  it('only allows .env* names in the worktree root', () => {
    for (const ok of ['.env', '.env.local', '.env.development.local', '.env_test']) expect(safeEnvName(ok)).toBe(true)
    for (const bad of ['env', '../.env', '.env/../x', '.env..', 'foo.env', '.bashrc', '']) expect(safeEnvName(bad)).toBe(false)
  })
})
