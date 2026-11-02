// Guest passes / referral upsell removed with the claude.ai account stack
// (src/services/api/referral.ts deleted). Null stubs keep the LogoV2 /
// CondensedLogo prop plumbing compiling; hooks always report "not shown".

export function useShowGuestPassesUpsell(): boolean {
	return false;
}

export function incrementGuestPassesSeenCount(): void {}

export function GuestPassesUpsell(): null {
	return null;
}
