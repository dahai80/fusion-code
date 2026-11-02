/**
 * Worktree mode is now unconditionally enabled for all users.
 *
 * Previously gated by GrowthBook flag 'fusion_worktree_mode', but the
 * CACHED_MAY_BE_STALE pattern returns the default (false) on first launch
 * before the cache is populated, silently swallowing --worktree.
 * See upstream issue 27044.
 */
export function isWorktreeModeEnabled(): boolean {
	return true;
}
