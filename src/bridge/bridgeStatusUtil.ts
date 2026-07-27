// bridge stubs - cloud-only module removed
export type BridgeStatus = { // log: fix TS2339
    label: string
    color: string
}
export const getBridgeStatus = (_opts?: {
    error?: unknown
    connected?: boolean
    sessionActive?: boolean
    reconnecting?: boolean
}): BridgeStatus => ({ label: 'idle', color: 'gray' })
export const buildBridgeConnectUrl = (): string => ''
export const buildActiveFooterText = (): string => ''
export const buildIdleFooterText = (): string => ''
export const FAILED_FOOTER_TEXT = ''
export const computeGlimmerIndex = (_length: number, _index: number): number => _index % _length
export const computeShimmerSegments = (_length: number): number[] => Array.from({ length: _length }, (_, i) => i)
export const SHIMMER_INTERVAL_MS = 100
