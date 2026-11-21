// SessionEnd automatic trajectory collection — closes the training flywheel loop automatically (insight-0902 E1)
//
// On session exit, automatically collects the session jsonl files under ~/.fusion-code/projects into
// ~/.fusion/trajectories, without requiring the user to manually run `fusion-code trajectory collect`.
//
// Gating: FUSION_CODE_TRAJECTORY_AUTOCOLLECT=1 (default off = byte-identical-off).
// fail-open: collection failure is only logged, never blocks session exit.
// Skipped in test environments (isTestEnv), avoiding test pollution of the aggregation store.

import { isTestEnv } from "../../utils/buildConstants.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import {
	collectTrajectories,
	DEFAULT_DEST_DIR,
	DEFAULT_SOURCE_DIR,
} from "./collector.js";

const AUTOCOLLECT_ENV = "FUSION_CODE_TRAJECTORY_AUTOCOLLECT";
const DEFAULT_PRODUCT = "fusion-code";

// Whether auto-collection is enabled (not compile-time gated: this module is always in the bundle, but does not execute by default).
export function isTrajectoryAutoCollectEnabled(): boolean {
	return isEnvTruthy(process.env[AUTOCOLLECT_ENV]);
}

// SessionEnd hook: automatically collect the current session trajectory. fail-open.
// sourceDir uses DEFAULT_SOURCE_DIR (includes all cwd-slug subdirectories, collector scans recursively),
// destDir uses DEFAULT_DEST_DIR (~/.fusion/trajectories).
export async function autoCollectTrajectoryOnSessionEnd(): Promise<void> {
	if (!isTrajectoryAutoCollectEnabled()) {
		return;
	}
	if (isTestEnv()) {
		logForDebugging("[trajectory] autoCollect skipped in test env");
		return;
	}
	try {
		logForDebugging(
			`[trajectory] autoCollect start source=${DEFAULT_SOURCE_DIR} dest=${DEFAULT_DEST_DIR}`,
		);
		const manifest = await collectTrajectories({
			sourceDir: DEFAULT_SOURCE_DIR,
			destDir: DEFAULT_DEST_DIR,
			product: DEFAULT_PRODUCT,
		});
		logForDebugging(
			`[trajectory] autoCollect done sessions=${manifest.totals.sessions} steps=${manifest.totals.steps} positive=${manifest.totals.positive} selfCorrection=${manifest.totals.selfCorrection}`,
		);
	} catch (e) {
		// fail-open: collection failure does not affect exit
		logForDebugging(
			`[trajectory] autoCollect failed (fail-open): ${(e as Error).message}`,
		);
	}
}
