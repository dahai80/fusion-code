// log: created for TS2307 fix

export type LspServerState = 'starting' | 'running' | 'stopped' | 'error'

export type ScopedLspServerConfig = {
    command: string
    args?: string[]
    env?: Record<string, string>
    workspaceFolder?: string
    initializationOptions?: Record<string, unknown>
    startupTimeout?: number
    shutdownTimeout?: number
    restartOnCrash?: boolean
    maxRestarts?: number
}
