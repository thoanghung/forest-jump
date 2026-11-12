import { useState } from 'react'
import type { Settings } from '@shared/types'

interface Props {
  settings: Settings
  onSave: (s: Settings) => Promise<void>
  onClose: () => void
}

export default function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [editor, setEditor] = useState(settings.editorCommand)
  const [terminal, setTerminal] = useState(settings.terminalCommand)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="muted small">
          <code>{'{path}'}</code> is replaced by the worktree path. Both commands start with the worktree as working
          directory. Quote arguments with spaces.
        </p>
        <label>
          Editor command <span className="muted">— without <code>{'{path}'}</code> the path is appended</span>
        </label>
        <input
          className="mono"
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
          placeholder="code   or   wezterm start --new-tab --cwd {path} -- nvim {path}"
        />
        <label>Terminal command</label>
        <input
          className="mono"
          value={terminal}
          onChange={(e) => setTerminal(e.target.value)}
          placeholder="x-terminal-emulator   or   wezterm start --new-tab --cwd {path}"
        />
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => void onSave({ editorCommand: editor.trim() || 'code', terminalCommand: terminal.trim() || 'x-terminal-emulator' })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
