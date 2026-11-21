// P0-3 (audit R2): git-family source commit sha pin gate — standalone pure module.
//
// Extracted from pluginLoader.ts so unit tests can import this module directly
// without triggering the settings loading chain (pluginLoader importing
// settings/settings.js → settings.ts module-level reference to isLoadingSettings
// triggers a TDZ). This module depends only on envUtils + debug, no settings chain.
//
// Missing sha → cloning the default branch = a moving target, supply chain not
// reproducible (today v1.0, tomorrow v1.0 + a malicious commit).
// Enterprise baseline forces a pinned commit. LENIENT mode
// (FUSION_CODE_PLUGIN_SHA256_LENIENT=1, same env shared with archive) keeps a
// compatibility window for sha-less clones (gradual migration of trusted registries).

import { logForDebugging } from "../debug.js";
import { isEnvTruthy } from "../envUtils.js";

export function requireGitShaPin(
	sourceKind: string,
	identifier: string,
	sha: string | undefined,
): void {
	if (sha) return;
	if (isEnvTruthy(process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT)) {
		logForDebugging(
			`[plugins] git source (${sourceKind}) ${identifier} has no sha pin, LENIENT mode allows unpinned clone`,
		);
		return;
	}
	throw new Error(
		`git source (${sourceKind}) ${identifier} missing commit sha pin: ` +
			"commit pinning required by default (enterprise supply-chain baseline). " +
			"Add a sha field to the source, or set " +
			"FUSION_CODE_PLUGIN_SHA256_LENIENT=1 to allow unpinned (fail-open).",
	);
}
