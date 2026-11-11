import { createConnection, createServer } from 'node:net'

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', (err: NodeJS.ErrnoException) => {
      // EADDRNOTAVAIL: host (e.g. ::) not available on this machine — not a conflict.
      resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')
    })
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)))
  })
}

/** True when nothing is bound to the port on IPv4 or IPv6. */
export async function isPortFree(port: number): Promise<boolean> {
  return (await canListen(port, '127.0.0.1')) && (await canListen(port, '0.0.0.0')) && (await canListen(port, '::'))
}

/** True when something accepts TCP connections on localhost:port. */
export function isPortListening(port: number, timeoutMs = 800): Promise<boolean> {
  const tryHost = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const sock = createConnection({ port, host })
      const done = (ok: boolean): void => {
        sock.destroy()
        resolve(ok)
      }
      sock.setTimeout(timeoutMs, () => done(false))
      sock.once('connect', () => done(true))
      sock.once('error', () => done(false))
    })
  return tryHost('127.0.0.1').then((ok) => ok || tryHost('::1'))
}
