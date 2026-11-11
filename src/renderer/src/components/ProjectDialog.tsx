import { useState } from 'react'
import type { Project, ProjectDetection } from '@shared/types'

interface Props {
  project: Project | null
  onSave: (p: Project) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClose: () => void
}

export default function ProjectDialog({ project, onSave, onRemove, onClose }: Props) {
  const [repoPath, setRepoPath] = useState(project?.repoPath ?? '')
  const [name, setName] = useState(project?.name ?? '')
  const [command, setCommand] = useState(project?.command ?? '')
  const [detection, setDetection] = useState<ProjectDetection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const detect = async (path: string, fill: boolean): Promise<void> => {
    if (!path) return
    setError(null)
    try {
      const d = await window.api.detectProject(path)
      setDetection(d)
      if (fill) {
        setName(d.name)
        setCommand(d.suggestedCommand)
      }
    } catch (err) {
      setDetection(null)
      setError(err instanceof Error && /not a git repository/i.test(err.message) ? 'Not a git repository' : String(err))
    }
  }

  const pick = async (): Promise<void> => {
    const p = await window.api.pickFolder()
    if (p) {
      setRepoPath(p)
      await detect(p, !project)
    }
  }

  const save = async (): Promise<void> => {
    setError(null)
    try {
      if (!repoPath) throw new Error('Choose the repo folder')
      if (!command.trim()) throw new Error('Enter the dev command')
      setSaving(true)
      await onSave({
        id: project?.id ?? crypto.randomUUID(),
        name: name.trim() || repoPath.split('/').pop()!,
        repoPath,
        command: command.trim()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{project ? 'Edit project' : 'Add project'}</h2>

        <label>Repository folder</label>
        <div className="input-row">
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            onBlur={() => repoPath && repoPath !== project?.repoPath && void detect(repoPath, !project && !command)}
            placeholder="/path/to/repo (main checkout or any worktree)"
            className="mono"
          />
          <button onClick={pick}>Browse…</button>
        </div>

        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />

        <label>Dev command</label>
        <input
          className="mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          list="cmd-options"
          placeholder="npx expo start"
        />
        <datalist id="cmd-options">
          {detection?.commandOptions.map((c) => <option key={c} value={c} />)}
        </datalist>
        {detection && detection.commandOptions.length > 0 && (
          <div className="chips">
            {detection.commandOptions.slice(0, 8).map((c) => (
              <button key={c} className="chip mono" onClick={() => setCommand(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <p className="muted small">
          Runs in each worktree with that worktree&apos;s <code>.env</code> loaded. Set the port there (
          <code>PORT</code>, or <code>RCT_METRO_PORT</code> for Expo) so worktrees can run side by side.
        </p>

        {error && <div className="error-box">{error}</div>}

        <div className="modal-actions">
          {project && (
            <button
              className="danger ghost"
              onClick={() => {
                if (confirm(`Remove project "${project.name}"? (Nothing on disk is deleted.)`)) void onRemove(project.id)
              }}
            >
              Remove
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>
            {project ? 'Save' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  )
}
