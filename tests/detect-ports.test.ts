import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { suggest } from '../src/main/detect'
import { isPortFree, isPortListening } from '../src/main/ports'
import { childEnv } from '../src/main/process-manager'

describe('suggest', () => {
  it('expo project → its start script when it runs expo start', () => {
    const d = suggest({ dependencies: { expo: '1' }, scripts: { start: 'expo start', lint: 'x' } }, 'pnpm', 'm')
    expect(d.suggestedCommand).toBe('pnpm run start')
    expect(d.commandOptions).toEqual(['pnpm run start', 'pnpm run lint'])
  })

  it('expo project without a script → exec expo start', () => {
    expect(suggest({ dependencies: { expo: '1' } }, 'npm', 'm').suggestedCommand).toBe('npx expo start')
  })

  it('nest project → start:dev', () => {
    const d = suggest(
      { name: 'api', dependencies: { '@nestjs/core': '1' }, scripts: { start: 'nest start', 'start:dev': 'nest start --watch' } },
      'npm',
      'x'
    )
    expect(d).toMatchObject({ name: 'api', suggestedCommand: 'npm run start:dev' })
  })

  it('unknown project without scripts → empty suggestion, folder name', () => {
    expect(suggest({}, 'npm', 'folder')).toMatchObject({ name: 'folder', suggestedCommand: '', commandOptions: [] })
  })
})

describe('ports', () => {
  it('detects a real listening port', async () => {
    const srv = createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    expect(await isPortFree(port)).toBe(false)
    expect(await isPortListening(port)).toBe(true)
    await new Promise<void>((r) => srv.close(() => r()))
    expect(await isPortFree(port)).toBe(true)
  })
})

describe('childEnv', () => {
  it('strips Electron/Vite vars and applies extras', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.NODE_ENV = 'development'
    const env = childEnv({ PORT: '3001' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_ENV).toBeUndefined()
    expect(env.PORT).toBe('3001')
    delete process.env.ELECTRON_RUN_AS_NODE
  })
})

describe('ProcessManager run cleanup', () => {
  it('removes a stopped run but keeps a crashed one', async () => {
    const { ProcessManager } = await import('../src/main/process-manager')
    const pm = new ProcessManager()
    const removed: string[] = []
    pm.on('removed', (id: string) => removed.push(id))
    const base = { projectId: 'p', label: 'x', kind: 'dev' as const, port: null, env: {}, worktreePath: process.cwd() }

    pm.start({ ...base, id: 'stopped', command: 'sleep 30' })
    pm.start({ ...base, id: 'crashed', command: 'exit 3' })
    await pm.stop('stopped')
    await new Promise((r) => setTimeout(r, 1500))

    expect(removed).toEqual(['stopped'])
    expect(pm.get('stopped')).toBeUndefined()
    expect(pm.get('crashed')?.status).toBe('crashed')
  }, 15000)
})
