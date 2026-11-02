// Overage-credit upsell removed with the claude.ai account stack
// (src/services/api/overageCreditGrant.ts deleted). Null stubs keep the
// LogoV2 / CondensedLogo / Settings-Usage plumbing compiling.

export function useShowOverageCreditUpsell(): boolean {
	return false;
}

export function incrementOverageCreditUpsellSeenCount(): void {}

export function isEligibleForOverageCreditGrant(): boolean {
	return false;
}

export function OverageCreditUpsell(_props: {
	maxWidth?: number;
	twoLine?: boolean;
}): null {
	return null;
}
