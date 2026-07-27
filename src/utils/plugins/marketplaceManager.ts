// marketplaceManager.ts - stub for cloud-only marketplace removal
// All marketplace functions return empty/no-op values

export interface MarketplaceConfig {
	id?: string;
	name?: string;
	url?: string;
	forceRemoveDeletedPlugins?: boolean; // log: fix TS2339
	allowCrossMarketplaceDependenciesOn?: string[]; // log: fix TS2339
	plugins?: import("./schemas.js").PluginMarketplaceEntry[]; // log: fix TS2339
	installLocation?: string; // log: fix TS2339
	source?: import("./schemas.js").MarketplaceSource; // log: fix TS2339
	lastUpdated?: string; // log: fix TS2353 - lastUpdated missing
	autoUpdate?: boolean; // log: fix TS2559 - autoUpdate missing
}

export interface MarketplacePlugin {
	id: string;
	name: string;
	description?: string;
	entry?: import("./schemas.js").PluginMarketplaceEntry; // log: fix TS2339
	marketplaceInstallLocation?: string; // log: fix TS2339
}

export interface DeclaredMarketplace {
	source: import("./schemas.js").MarketplaceSource; // log: fix TS2345 - source is MarketplaceSource, not string
	enabled: boolean;
	autoUpdate?: boolean; // log: fix TS2345 - autoUpdate field
	sourceIsFallback?: boolean; // log: fix TS2339
}

export const getPluginById = (_pluginId: string): MarketplacePlugin | null =>
	null;
export const getPluginByIdCacheOnly = (
	_pluginId: string,
): MarketplacePlugin | null => null;
export const getMarketplace = (
	_marketplaceId: string,
): MarketplaceConfig | null => null;
export const getMarketplaceCacheOnly = (
	_marketplaceId: string,
): MarketplaceConfig | null => null;
// log: fix TS2345 - return Record<string, DeclaredMarketplace> to match reconciler expectations
export const getDeclaredMarketplaces = (): Record<
	string,
	DeclaredMarketplace
> => ({});
export const getMarketplacesCacheDir = (): string => "";
// log: fix TS2345 - return Record to match usage pattern
export const loadKnownMarketplacesConfigSafe = async (): Promise<
	import("./schemas.js").KnownMarketplacesFile
> => ({});
// log: fix TS2322 - return KnownMarketplacesFile compatible type
export const loadKnownMarketplacesConfig = async (): Promise<
	import("./schemas.js").KnownMarketplacesFile
> => ({});
export const saveKnownMarketplacesConfig = async (
	_config: unknown,
): Promise<void> => {};
export const saveMarketplaceToSettings = async (
	_marketplace: unknown,
): Promise<void> => {};
export const clearMarketplacesCache = (): void => {};
export const registerSeedMarketplaces = async (): Promise<void> => {};
export const refreshMarketplace = async (
	_marketplaceId: string,
): Promise<void> => {};
export const refreshAllMarketplaces = async (): Promise<void> => {};
// log: fix TS2345 - accept MarketplaceSource | string, not just string
export const addMarketplaceSource = async (
	_source: import("./schemas.js").MarketplaceSource | string,
): Promise<{
	name: string;
	alreadyMaterialized: boolean;
	resolvedSource: unknown;
}> => ({ name: "", alreadyMaterialized: false, resolvedSource: {} });
export const removeMarketplaceSource = async (
	_source: string,
): Promise<void> => {};
