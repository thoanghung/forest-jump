import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AppConfig, Project, Settings } from '../shared/types'

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repoPath: z.string().min(1),
  command: z.string().min(1)
})

const settingsSchema = z.object({
  editorCommand: z.string().default('code'),
  terminalCommand: z.string().default('x-terminal-emulator')
})

const configSchema = z.object({
  version: z.literal(1).default(1),
  settings: settingsSchema.default({}),
  projects: z.array(projectSchema).default([])
})

export const defaultConfig = (): AppConfig => configSchema.parse({})

export function validateProject(p: Project): Project {
  return projectSchema.parse(p)
}

export class ConfigStore {
  private config: AppConfig

  constructor(private readonly file: string) {
    this.config = this.load()
  }

  private load(): AppConfig {
    if (!existsSync(this.file)) return defaultConfig()
    try {
      return configSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (err) {
      // Keep the broken file around instead of silently losing it.
      const backup = `${this.file}.broken-${Date.now()}`
      renameSync(this.file, backup)
      console.error(`Invalid config, moved to ${backup}:`, err)
      return defaultConfig()
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.config, null, 2))
    renameSync(tmp, this.file)
  }

  get(): AppConfig {
    return this.config
  }

  project(id: string): Project {
    const p = this.config.projects.find((x) => x.id === id)
    if (!p) throw new Error(`Unknown project ${id}`)
    return p
  }

  upsertProject(project: Project): AppConfig {
    const p = validateProject(project)
    const i = this.config.projects.findIndex((x) => x.id === p.id)
    if (i >= 0) this.config.projects[i] = p
    else this.config.projects.push(p)
    this.save()
    return this.config
  }

  removeProject(id: string): AppConfig {
    this.config.projects = this.config.projects.filter((p) => p.id !== id)
    this.save()
    return this.config
  }

  setSettings(settings: Settings): AppConfig {
    this.config.settings = settingsSchema.parse(settings)
    this.save()
    return this.config
  }
}
