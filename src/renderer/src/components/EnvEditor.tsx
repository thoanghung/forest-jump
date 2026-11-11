import { useCallback, useEffect, useState } from 'react'
import type { EnvFileList } from '@shared/types'
import { prettyPath } from '../util'

interface Props {
  projectId: string
  worktreePath: string
  title: string
  /** The worktree's dev server is running (offer a restart after saving). */
  running: boolean
  onRestart: () => void
  onClose: () => void
}

export default function EnvEditor({ projectId, worktreePath, title, running, onRestart, onClose }: Props) {
  const api = window.api
  const [list, setList] = useState<EnvFileList | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  /** Name of a file being created that doesn't exist on disk yet. */
  const [draftName, setDraftName] = useState<string | null>(null)
  const [newName, setNewName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const dirty = content !== saved || draftName != null
  const fail = (err: unknown): void => setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

  const loadList = useCallback(async (): Promise<EnvFileList> => {
    const l = await api.listEnvFiles(projectId, worktreePath)
    setList(l)
    return l
  }, [api, projectId, worktreePath])

  const open = useCallback(
    async (name: string) => {
      setError(null)
      setJustSaved(false)
      try {
        const f = await api.readEnvFile(projectId, worktreePath, name)
        setCurrent(name)
        setContent(f.content)
        setSaved(f.content)
        setDraftName(null)
      } catch (err) {
        fail(err)
      }
    },
    [api, projectId, worktreePath]
  )

  useEffect(() => {
    void loadList()
      .then((l) => {
        if (l.files.length) return open(l.files[0])
        // No .env yet: start a draft so the user can type right away.
        setCurrent('.env')
        setDraftName('.env')
        setContent('')
        setSaved('')
        return undefined
      })
      .catch(fail)
  }, [loadList, open])

  const confirmDiscard = (): boolean => !dirty || confirm('Discard unsaved changes?')

  const switchTo = (name: string): void => {
    if (name === current || !confirmDiscard()) return
    void open(name)
  }

  const save = async (): Promise<void> => {
    if (!current) return
    setError(null)
    try {
      await api.writeEnvFile(projectId, worktreePath, current, content)
      setSaved(content)
      setDraftName(null)
      setJustSaved(true)
      await loadList()
    } catch (err) {
      fail(err)
    }
  }

  const createFile = (): void => {
    const name = (newName ?? '').trim()
    if (!/^\.env[\w.-]*$/.test(name)) return setError('File name must start with .env (e.g. .env.local)')
    if (list?.files.includes(name)) return setError(`${name} already exists`)
    if (!confirmDiscard()) return
    setError(null)
    setNewName(null)
    setCurrent(name)
    setDraftName(name)
    setContent('')
    setSaved('')
    setJustSaved(false)
  }

  const copyFromMain = async (name: string): Promise<void> => {
    if (!confirmDiscard()) return
    try {
      await api.copyEnvFromMain(projectId, worktreePath, name)
      await loadList()
      await open(name)
    } catch (err) {
      fail(err)
    }
  }

  const close = (): void => {
    if (confirmDiscard()) onClose()
  }

  const tabs = [...(list?.files ?? [])]
  if (draftName && !tabs.includes(draftName)) tabs.push(draftName)

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal env-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') close()
        }}
      >
        <div className="env-head">
          <div>
            <h2>Environment · {title}</h2>
            <div className="muted mono small">{prettyPath(worktreePath)}</div>
          </div>
        </div>

        <div className="env-tabs">
          {tabs.map((f) => (
            <button key={f} className={`env-tab mono ${f === current ? 'on' : ''}`} onClick={() => switchTo(f)}>
              {f}
              {f === current && dirty ? ' •' : ''}
            </button>
          ))}
          {newName == null ? (
            <button className="ghost small" onClick={() => setNewName(tabs.includes('.env') ? '.env.local' : '.env')}>
              + New file
            </button>
          ) : (
            <span className="new-file">
              <input
                autoFocus
                className="mono"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createFile()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewName(null)
                  }
                }}
              />
              <button onClick={createFile}>Create</button>
            </span>
          )}
        </div>

        {list && list.missingFromMain.length > 0 && (
          <div className="env-missing">
            In main worktree but not here:{' '}
            {list.missingFromMain.map((f) => (
              <button key={f} className="link mono" onClick={() => void copyFromMain(f)} title="Copy from main worktree">
                ⧉ {f}
              </button>
            ))}
          </div>
        )}

        <textarea
          className="mono env-text"
          spellCheck={false}
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setJustSaved(false)
          }}
          placeholder={'PORT=3001\nDATABASE_URL=postgres://localhost/app_feat_a'}
          autoFocus
        />

        {error && <div className="error-box">{error}</div>}

        <div className="modal-actions">
          <span className="muted small">
            {justSaved ? `Saved ${current}.` : 'Ctrl+S to save. PORT / RCT_METRO_PORT here decides the port.'}
          </span>
          <span className="spacer" />
          {justSaved && running && (
            <button
              onClick={() => {
                onRestart()
                onClose()
              }}
            >
              ↻ Restart to apply
            </button>
          )}
          <button onClick={close}>Close</button>
          <button className="primary" disabled={!dirty || !current} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
