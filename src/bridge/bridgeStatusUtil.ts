// bridge stubs - cloud-only module removed
export type BridgeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed'
export const getBridgeStatus = (): BridgeStatus => 'idle'
export const buildBridgeConnectUrl = (): string => ''
export const buildActiveFooterText = (): string => ''
export const buildIdleFooterText = (): string => ''
export const FAILED_FOOTER_TEXT = ''
export const computeGlimmerIndex = (_length: number, _index: number): number => _index % _length
export const computeShimmerSegments = (_length: number): number[] => Array.from({ length: _length }, (_, i) => i)
export const SHIMMER_INTERVAL_MS = 100
