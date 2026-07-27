// bridge stubs - cloud-only module removed
export const isBridgeEnabled = (): boolean => false;

/**
 * Returns null if bridge is enabled, or a string reason if disabled.
 * log: fix TS2339
 */
export async function getBridgeDisabledReason(): Promise<string | null> {
	if (isBridgeEnabled()) return null;
	return "Bridge mode is not available";
}

/**
 * Check if CCR mirror mode is enabled.
 * log: fix TS2339
 */
export const isCcrMirrorEnabled = (): boolean => false;

/**
 * Returns the CCR auto-connect default from GrowthBook.
 * log: fix TS2339
 */
export const getCcrAutoConnectDefault = (): boolean => false;

/**
 * No-op stub for bridge version check (cloud-only).
 * log: fix TS2339
 */
export async function checkBridgeMinVersion(): Promise<void> {}
