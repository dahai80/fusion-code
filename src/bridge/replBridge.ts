export type BridgeState = 'idle' | 'connecting' | 'connected' | 'disconnected'
export interface ReplBridgeHandle {
    environmentId: string
    bridgeSessionId: string
    sessionIngressUrl: string
    teardown(): Promise<void>
    writeSdkMessages(messages: unknown[]): void
    writeMessages(messages: unknown[]): void
    sendControlRequest(request: unknown): void
    sendControlResponse(response: unknown): void
    sendControlCancelRequest(requestId: string): void
    sendResult(result: unknown): void
}
