/**
 * Server lockfile — cloud-only stub
 *
 * log: fix TS2339
 */

export interface ServerLock {
    pid: number
    port: number
    host: string
    httpUrl: string
    startedAt: number
}

export async function writeServerLock(_lock: ServerLock): Promise<void> {
    throw new Error('writeServerLock is not available in this build')
}

export async function removeServerLock(): Promise<void> {
    throw new Error('removeServerLock is not available in this build')
}

export async function probeRunningServer(): Promise<ServerLock | null> {
    return null
}
