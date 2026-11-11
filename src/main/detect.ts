import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { PackageManager, ProjectDetection } from '../shared/types'

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  return 'npm'
}

/** Command that runs a package binary (`npx expo`, `pnpm exec expo`, ...). */
export function execPrefix(pm: PackageManager): string {
  return { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm]
}

export function runScript(pm: PackageManager, script: string): string {
  return `${pm} run ${script}`
}

export function installCommand(pm: PackageManager): string {
  return `${pm} install`
}

/** Pure part of detection, so it can be unit-tested without a filesystem. */
export function suggest(pkg: PackageJson, pm: PackageManager, fallbackName: string): ProjectDetection {
  const scripts = pkg.scripts ?? {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const pick = (...names: string[]): string | undefined => names.find((k) => k in scripts)

  let suggestedCommand = ''
  if ('expo' in deps) {
    const s = pick('start', 'dev')
    suggestedCommand = s && /expo start/.test(scripts[s]) ? runScript(pm, s) : `${execPrefix(pm)} expo start`
  } else if ('@nestjs/core' in deps) {
    const s = pick('start:dev', 'dev', 'start')
    suggestedCommand = s ? runScript(pm, s) : `${execPrefix(pm)} nest start --watch`
  } else {
    const s = pick('dev', 'start:dev', 'start')
    suggestedCommand = s ? runScript(pm, s) : ''
  }

  const scriptCmds = Object.keys(scripts).map((s) => runScript(pm, s))
  return {
    name: pkg.name || fallbackName,
    scripts,
    suggestedCommand,
    commandOptions: Array.from(new Set([suggestedCommand, ...scriptCmds].filter(Boolean)))
  }
}

export function detectProject(dir: string): ProjectDetection {
  let pkg: PackageJson = {}
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
  } catch {
    /* not a node project, that's fine */
  }
  return suggest(pkg, detectPackageManager(dir), basename(dir))
}
