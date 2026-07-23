// marketplaceManager.ts - stub for cloud-only marketplace removal
// All marketplace functions return empty/no-op values

export interface MarketplaceConfig {
    id: string
    name: string
    url: string
}

export interface MarketplacePlugin {
    id: string
    name: string
    description?: string
}

export interface DeclaredMarketplace {
    source: string
    enabled: boolean
}

export const getPluginById = (_pluginId: string): MarketplacePlugin | null => null
export const getPluginByIdCacheOnly = (_pluginId: string): MarketplacePlugin | null => null
export const getMarketplace = (_marketplaceId: string): MarketplaceConfig | null => null
export const getMarketplaceCacheOnly = (_marketplaceId: string): MarketplaceConfig | null => null
export const getDeclaredMarketplaces = (): DeclaredMarketplace[] => []
export const getMarketplacesCacheDir = (): string => ''
export const loadKnownMarketplacesConfigSafe = (): MarketplaceConfig[] => []
export const loadKnownMarketplacesConfig = async (): Promise<Record<string, MarketplaceConfig>> => ({})
export const saveKnownMarketplacesConfig = async (_config: unknown): Promise<void> => {}
export const saveMarketplaceToSettings = async (_marketplace: unknown): Promise<void> => {}
export const clearMarketplacesCache = (): void => {}
export const registerSeedMarketplaces = async (): Promise<void> => {}
export const refreshMarketplace = async (_marketplaceId: string): Promise<void> => {}
export const refreshAllMarketplaces = async (): Promise<void> => {}
export const addMarketplaceSource = async (_source: string): Promise<void> => {}
export const removeMarketplaceSource = async (_source: string): Promise<void> => {}
