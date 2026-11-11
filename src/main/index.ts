import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { ConfigStore } from './config'
import { registerIpc } from './ipc'
import { ProcessManager } from './process-manager'

// Keep settings in ~/.config/forest-jump (not "Forest Jump" from productName).
app.setName('Forest Jump')
app.setPath('userData', join(app.getPath('appData'), 'forest-jump'))

/** The app was called "env-control" before; bring its project list along once. */
function migrateOldConfig(): void {
  const oldFile = join(app.getPath('appData'), 'env-control', 'config.json')
  const newFile = join(app.getPath('userData'), 'config.json')
  if (existsSync(newFile) || !existsSync(oldFile)) return
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    copyFileSync(oldFile, newFile)
  } catch (err) {
    console.error('Could not migrate old config:', err)
  }
}

let win: BrowserWindow | null = null
const pm = new ProcessManager()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    title: 'Forest Jump',
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Open external links in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  win.on('closed', () => (win = null))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    migrateOldConfig()
    const config = new ConfigStore(join(app.getPath('userData'), 'config.json'))
    registerIpc(() => win, config, pm)
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())

  // Stop every dev server before quitting so no Metro/Nest process is left holding a port.
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting || pm.list().every((r) => r.status === 'exited' || r.status === 'crashed')) return
    e.preventDefault()
    quitting = true
    const hardStop = setTimeout(() => {
      pm.killAllSync()
      app.quit()
    }, 6000)
    void pm.stopAll().then(() => {
      clearTimeout(hardStop)
      app.quit()
    })
  })
  process.on('exit', () => pm.killAllSync())
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      pm.killAllSync()
      process.exit(0)
    })
  }
}
