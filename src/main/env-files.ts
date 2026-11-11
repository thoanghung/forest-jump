import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Files loaded into a run's env, lowest priority first (same order as Expo / dotenv-flow). */
export const ENV_LOAD_ORDER = ['.env', '.env.development', '.env.local', '.env.development.local']

/** Env vars checked (in order) to find which port a worktree's dev server uses. */
export const PORT_KEYS = ['PORT', 'RCT_METRO_PORT', 'EXPO_PORT', 'APP_PORT', 'SERVER_PORT']

/** A name we're willing to read/write: `.env`, `.env.local`, `.env.staging`, ... */
export function safeEnvName(name: string): boolean {
  return /^\.env[\w.-]*$/.test(name) && !name.includes('..') && name.length <= 100
}

/** Minimal dotenv parser: KEY=VALUE, `export ` prefix, single/double quotes, `#` comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trimStart()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    const q = value[0]
    if ((q === '"' || q === "'" || q === '`') && value.indexOf(q, 1) > 0) {
      value = value.slice(1, value.indexOf(q, 1))
      if (q === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"')
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    out[key] = value
  }
  return out
}

/** Merged env of a worktree's .env files (later files in ENV_LOAD_ORDER win). */
export function loadWorktreeEnv(dir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const f of ENV_LOAD_ORDER) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    try {
      Object.assign(env, parseDotenv(readFileSync(p, 'utf8')))
    } catch {
      /* unreadable, skip */
    }
  }
  return env
}

export function portFromEnv(env: Record<string, string>): { port: number; key: string } | null {
  for (const key of PORT_KEYS) {
    const n = Number(env[key])
    if (env[key] && Number.isInteger(n) && n > 0 && n <= 65535) return { port: n, key }
  }
  return null
}
