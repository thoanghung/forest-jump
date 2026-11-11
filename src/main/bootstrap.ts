import { constants, copyFileSync } from 'node:fs'
import { join } from 'node:path'

/** Copy the given `.env*` files from the main worktree; never overwrites existing files. */
export function copyEnvFiles(fromDir: string, toDir: string, files: string[]): string[] {
  const copied: string[] = []
  for (const f of files) {
    if (!/^\.env/.test(f) || f.includes('/')) continue
    try {
      copyFileSync(join(fromDir, f), join(toDir, f), constants.COPYFILE_EXCL)
      copied.push(f)
    } catch {
      /* exists already or vanished */
    }
  }
  return copied
}
