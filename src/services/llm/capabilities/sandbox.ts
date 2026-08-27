// SandboxCapability seam (ar-plan PR #4, S1.e — stub only).
// Provider-neutral sandbox facade — applyTo(spawnOpts)/checkPath(path). macOS
// seatbelt stays in BashTool (untouched); Linux Landlock is a cross-repo
// fusion-executor dependency (arch-ecosystem §6), deferred. This seam only
// exists so ctx.sandbox? can be injected later without re-touching consumers.
// NoneSandboxProvider is a no-op: applyTo identity, checkPath always true —
// byte-identical when injected (nothing changes). Default: not injected.
export interface SandboxCapability {
	readonly provider: "none" | "seatbelt" | "landlock";
	applyTo<T extends object>(spawnOpts: T): T;
	checkPath(path: string): boolean;
}

export class NoneSandboxProvider implements SandboxCapability {
	readonly provider = "none" as const;

	applyTo<T extends object>(spawnOpts: T): T {
		// No-op: passes spawn options through unchanged.
		return spawnOpts;
	}

	checkPath(_path: string): boolean {
		// No sandbox → every path is "in-sandbox" (no restriction).
		return true;
	}
}
