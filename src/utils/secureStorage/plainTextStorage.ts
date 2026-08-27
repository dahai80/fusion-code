import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import {
  jsonParse,
  jsonStringify,
} from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './types.js'

function getStoragePath(): { storageDir: string; storagePath: string } {
  const storageDir = getClaudeConfigHomeDir()
  const storageFileName = '.credentials.json'
  return { storageDir, storagePath: join(storageDir, storageFileName) }
}

export const plainTextStorage = {
  name: 'plaintext',
  read(): SecureStorageData | null {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      const data = getFsImplementation().readFileSync(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
  async readAsync(): Promise<SecureStorageData | null> {
    const { storagePath } = getStoragePath()
    try {
      const data = await getFsImplementation().readFile(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    // sync IO: called from sync context (SecureStorage interface)
    try {
      const { storageDir, storagePath } = getStoragePath()
      // dir 0700 (P0-9): default mkdirSync leaves 0755, allowing same-user
      // processes to readdir/unlink credential entries.
      try {
        getFsImplementation().mkdirSync(storageDir, { recursive: true, mode: 0o700 })
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'EEXIST') {
          throw e
        }
      }
      // Tighten existing dir to 0700 (umask may have widened it on prior runs).
      try {
        chmodSync(storageDir, 0o700)
      } catch {
        // non-fatal: best-effort hardening
      }

      // Atomic write (P0-9): write to tmp file with mode 0600 at creation
      // (never world-readable-to-start), fsync, then rename over the target.
      // Crash mid-write leaves either the old file intact or the complete new
      // file — never a truncated/partial credentials file that would lose all
      // stored tokens on next read.
      const tmpPath = `${storagePath}.${randomBytes(6).toString('hex')}.tmp`
      let fd: number | undefined
      try {
        fd = openSync(tmpPath, 'w', 0o600)
        writeFileSync(fd, jsonStringify(data), { encoding: 'utf8' })
        fsyncSync(fd)
      } finally {
        if (fd !== undefined) {
          closeSync(fd)
        }
      }
      renameSync(tmpPath, storagePath)
      return {
        success: true,
        warning: 'Warning: Storing credentials in plaintext. Install libsecret (Linux) or use macOS keychain for encrypted storage.',
      }
    } catch (e: unknown) {
      logForDebugging(`plainTextStorage.update failed: ${e}`)
      return { success: false }
    }
  },
  delete(): boolean {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      getFsImplementation().unlinkSync(storagePath)
      return true
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return true
      }
      return false
    }
  },
} satisfies SecureStorage
