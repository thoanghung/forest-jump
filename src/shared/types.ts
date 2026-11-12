export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export interface Project {
  id: string
  name: string
  /** Path to the main checkout (or any worktree) of the repo. */
  repoPath: string
  /** Dev command, run in the worktree. Ports/settings come from the worktree's own .env. */
  command: string
}

export interface EnvFile {
  name: string
  content: string
}

export interface EnvFileList {
  /** .env* files in this worktree. */
  files: string[]
  /** .env* files in the main worktree that this worktree doesn't have. */
  missingFromMain: string[]
}

export interface Settings {
  /** Command for "Open in editor". `{path}` = worktree path; without it the path is appended. */
  editorCommand: string
  /** Command for "Open terminal", started with cwd = worktree. `{path}` = worktree path. */
  terminalCommand: string
}

export interface AppConfig {
  version: 1
  settings: Settings
  projects: Project[]
}

export interface Worktree {
  path: string
  /** Short branch name, or null when detached. */
  branch: string | null
  head: string
  isMain: boolean
  locked: boolean
  prunable: boolean
  /** Directory exists on disk. */
  exists: boolean
  dirty: boolean
  ahead: number
  behind: number
  /** .env* files present in the main worktree but missing here. */
  missingEnv: string[]
  /** package.json exists but node_modules doesn't. */
  missingNodeModules: boolean
}

export interface WorktreeList {
  projectId: string
  worktrees: Worktree[]
  error: string | null
}

export type RunStatus = 'starting' | 'running' | 'exited' | 'crashed'
export type RunKind = 'dev' | 'setup'

export interface RunInfo {
  /** One run slot per worktree: the id is the worktree path. */
  id: string
  projectId: string
  worktreePath: string
  label: string
  kind: RunKind
  command: string
  port: number | null
  pid: number
  status: RunStatus
  exitCode: number | null
  startedAt: number
}

export interface LogSnapshot {
  text: string
  end: number
}

export interface ProjectDetection {
  name: string
  scripts: Record<string, string>
  suggestedCommand: string
  /** Ready-made command suggestions for the command field. */
  commandOptions: string[]
}

export interface Api {
  getConfig(): Promise<AppConfig>
  saveProject(project: Project): Promise<AppConfig>
  removeProject(id: string): Promise<AppConfig>
  saveSettings(settings: Settings): Promise<AppConfig>
  pickFolder(): Promise<string | null>
  detectProject(path: string): Promise<ProjectDetection>

  listWorktrees(projectId: string): Promise<WorktreeList>

  listRuns(): Promise<RunInfo[]>
  getLog(id: string): Promise<LogSnapshot>
  startDev(projectId: string, worktreePath: string): Promise<RunInfo>
  setupWorktree(projectId: string, worktreePath: string): Promise<RunInfo | null>
  stopRun(id: string): Promise<void>
  restartRun(id: string): Promise<RunInfo>
  clearRun(id: string): Promise<void>
  writeRun(id: string, data: string): void
  resizeRun(id: string, cols: number, rows: number): void

  listEnvFiles(projectId: string, worktreePath: string): Promise<EnvFileList>
  readEnvFile(projectId: string, worktreePath: string, name: string): Promise<EnvFile>
  writeEnvFile(projectId: string, worktreePath: string, name: string, content: string): Promise<void>
  /** Copy a .env* file from the main worktree (never overwrites). */
  copyEnvFromMain(projectId: string, worktreePath: string, name: string): Promise<void>

  openEditor(path: string): Promise<void>
  openTerminal(path: string): Promise<void>
  openFolder(path: string): Promise<void>
  openUrl(url: string): Promise<void>

  /** `end` = total chars written to this run's log after this chunk. */
  onRunData(cb: (id: string, data: string, end: number) => void): () => void
  onRunUpdate(cb: (run: RunInfo) => void): () => void
  onRunRemoved(cb: (id: string) => void): () => void
  onWorktreesChanged(cb: (projectId: string) => void): () => void
}
