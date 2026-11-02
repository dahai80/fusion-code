// Upstream auto-update machinery (npm registry check, Anthropic GCS bucket,
// native installer) was removed — fusion-code is built from source and released
// as git tags; `update` is a stub (src/cli/update.ts). This file keeps only the
// result types the REPL notification plumbing still threads through.

export type InstallStatus =
	| "success"
	| "no_permissions"
	| "install_failed"
	| "in_progress";

export type AutoUpdaterResult = {
	version: string | null;
	status: InstallStatus;
	notifications?: string[];
};
