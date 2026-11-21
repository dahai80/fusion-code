// D1 trajectory flywheel — unified module export (issue #50/#51)

// insight-0902 E1: SessionEnd automatic trajectory collection — closes the training flywheel loop automatically.
// Exposed via barrel (audit 1.1.3 Phase B layering rules).
export {
	autoCollectTrajectoryOnSessionEnd,
	isTrajectoryAutoCollectEnabled,
} from "./autoCollect.js";
export {
	collectTrajectories,
	DEFAULT_DEST_DIR,
	DEFAULT_SOURCE_DIR,
	loadCollectedTrajectory,
	MANIFEST_VERSION,
	readManifest,
} from "./collector.js";
export {
	buildDPOPairs,
	exportTrajectories,
	loadAll,
	toGRPOSample,
	toSFTSample,
} from "./exporters.js";
// #203 Phase B (audit 1.1.3): trajectory barrel re-export completion.
// trainerCli.js was not re-exported in the original D1 barrel — appended here
// so consumers outside src/services/ reach it via the barrel entry point.
export type {
	TrainerCliOptions,
	TrainerCliResult,
	TrainerFormat,
} from "./trainerCli.js";
export { runTrainerCli } from "./trainerCli.js";
export type {
	CollectedTrajectory,
	CollectOptions,
	DPOPair,
	ExportFormat,
	ExportOptions,
	GRPOSample,
	ManifestEntry,
	SFTSample,
	ToolCall,
	ToolResult,
	TrajectoryLabel,
	TrajectoryManifest,
	TrajectoryStep,
} from "./types.js";
