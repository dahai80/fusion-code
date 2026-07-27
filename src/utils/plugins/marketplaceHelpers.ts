// marketplaceHelpers.ts - stub for cloud-only marketplace removal

export type MarketplaceSource = string
export type EmptyMarketplaceReason = 'no_marketplaces' | 'loading_failed' | 'empty'

export const formatFailureDetails = (_errors: Array<{ source: MarketplaceSource; error: Error }>): string => ''
export const getMarketplaceSourceDisplay = (source: MarketplaceSource): string => source
export const createPluginId = (source: MarketplaceSource, name: string): string => `${source}/${name}`
export const loadMarketplacesWithGracefulDegradation = async (): Promise<{ marketplaces: Array<{ name: string; data: unknown }>; errors: unknown[] }> => ({ marketplaces: [], errors: [] })
export const formatMarketplaceLoadingErrors = (_errors: unknown[]): string => ''
export const getStrictKnownMarketplaces = (): MarketplaceSource[] | null => null
export const getBlockedMarketplaces = (): MarketplaceSource[] | null => null
export const getPluginTrustMessage = (): string | undefined => undefined
export const extractHostFromSource = (source: MarketplaceSource): string => source
export const getHostPatternsFromAllowlist = (): string[] => []
export const isSourceInBlocklist = (_source: MarketplaceSource): boolean => false
export const isSourceAllowedByPolicy = (_source: MarketplaceSource): boolean => false
export const formatSourceForDisplay = (source: MarketplaceSource): string => source
export const detectEmptyMarketplaceReason = async (): Promise<EmptyMarketplaceReason | null> => null
