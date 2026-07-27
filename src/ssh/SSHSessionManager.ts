import type { RemoteMessageContent } from '../utils/teleport/api.js'
import type { PermissionAskDecision } from '../types/permissions.js'

export interface SSHSessionManager {
    connect: () => void
    disconnect: () => void
    sendMessage: (content: RemoteMessageContent) => Promise<boolean>
    sendInterrupt: () => void
    respondToPermissionRequest: (
        requestId: string,
        decision: PermissionAskDecision,
    ) => void
}
