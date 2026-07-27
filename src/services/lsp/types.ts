// log: created for TS2307 fix

export type LspServerConfig = {
    command: string
    args?: string[]
    extensionToLanguage: Record<string, string>
    transport: 'stdio' | 'socket'
    env?: Record<string, string>
    initializationOptions?: unknown
    settings?: unknown
    workspaceFolder?: string
    startupTimeout?: number
    shutdownTimeout?: number
    restartOnCrash?: boolean
    maxRestarts?: number
}

export type LspServerState = 'starting' | 'running' | 'stopped' | 'error'

export type ScopedLspServerConfig = LspServerConfig & {
    pluginName: string
    scope: string
}
