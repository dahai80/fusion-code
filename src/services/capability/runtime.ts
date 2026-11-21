// P5.5 capability manifest (Typert type graph) — runtime gating
// (enhance-0819.md §D.7 P5.5).
//
// Evaluated rather than copied: only ship the pure export function that
// builds the type graph from tool/skill/plugin definitions + the fast-path
// subcommand. The RPC-gateway remote control plane (security surface) is
// explicitly deferred.
// Double gate: feature("CAPABILITY_MANIFEST") at compile time (if inside
// cli.tsx) + FUSION_CODE_CAPABILITY_MANIFEST_ENABLED=1 at runtime (here +
// cli handler).
// Default off -> byte-identical, zero runtime impact.

export function isCapabilityManifestEnabled(): boolean {
	return process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED === "1";
}

// Manifest export options (inject cwd + timestamp, easing unit tests and
// avoiding environment access inside the pure function).
export interface CapabilityManifestOptions {
	cwd: string;
	// Caller supplies the timestamp (ISO); the pure function never reads
	// Date itself — keeps tests deterministic.
	generatedAt?: string;
	// Whether to include skills/plugins (default true; turning it off exports
	// tools only, reducing size).
	includeSkills?: boolean;
	includePlugins?: boolean;
	// Whether to serialize inputSchema (JSON Schema); default true. When off,
	// only the name graph is exported, minimal.
	includeSchemas?: boolean;
}
