import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, RunInfo } from '../shared/types'

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveProject: (p) => ipcRenderer.invoke('config:saveProject', p),
  removeProject: (id) => ipcRenderer.invoke('config:removeProject', id),
  saveSettings: (s) => ipcRenderer.invoke('config:saveSettings', s),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  detectProject: (path) => ipcRenderer.invoke('project:detect', path),

  listWorktrees: (projectId) => ipcRenderer.invoke('worktrees:list', projectId),

  listRuns: () => ipcRenderer.invoke('run:list'),
  getLog: (id) => ipcRenderer.invoke('run:log', id),
  startDev: (projectId, path) => ipcRenderer.invoke('run:startDev', projectId, path),
  setupWorktree: (projectId, path) => ipcRenderer.invoke('run:setup', projectId, path),
  stopRun: (id) => ipcRenderer.invoke('run:stop', id),
  restartRun: (id) => ipcRenderer.invoke('run:restart', id),
  clearRun: (id) => ipcRenderer.invoke('run:clear', id),
  writeRun: (id, data) => ipcRenderer.send('run:write', id, data),
  resizeRun: (id, cols, rows) => ipcRenderer.send('run:resize', id, cols, rows),

  listEnvFiles: (projectId, path) => ipcRenderer.invoke('env:list', projectId, path),
  readEnvFile: (projectId, path, name) => ipcRenderer.invoke('env:read', projectId, path, name),
  writeEnvFile: (projectId, path, name, content) => ipcRenderer.invoke('env:write', projectId, path, name, content),
  copyEnvFromMain: (projectId, path, name) => ipcRenderer.invoke('env:copyFromMain', projectId, path, name),

  openEditor: (path) => ipcRenderer.invoke('open:editor', path),
  openTerminal: (path) => ipcRenderer.invoke('open:terminal', path),
  openFolder: (path) => ipcRenderer.invoke('open:folder', path),
  openUrl: (url) => ipcRenderer.invoke('open:url', url),

  onRunData: (cb) => on<[string, string, number]>('run:data', cb),
  onRunUpdate: (cb) => on<[RunInfo]>('run:update', cb),
  onRunRemoved: (cb) => on<[string]>('run:removed', cb),
  onWorktreesChanged: (cb) => on<[string]>('worktrees:changed', cb)
}

contextBridge.exposeInMainWorld('api', api)
