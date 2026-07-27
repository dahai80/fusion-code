/**
 * SessionManager — cloud-only session manager stub
 *
 * log: fix TS2339
 */

export class SessionManager {
    constructor(_backend: unknown, _opts: { idleTimeoutMs: number; maxSessions: number }) {
        throw new Error('SessionManager is not available in this build')
    }
    async destroyAll(): Promise<void> {}
}
