// D1 轨迹飞轮 — 模块统一出口 (issue #50/#51)

export {
	collectTrajectories,
	readManifest,
	loadCollectedTrajectory,
	DEFAULT_SOURCE_DIR,
	DEFAULT_DEST_DIR,
	MANIFEST_VERSION,
} from "./collector.js";

export {
	exportTrajectories,
	toSFTSample,
	toGRPOSample,
	buildDPOPairs,
	loadAll,
} from "./exporters.js";

export type {
	ToolCall,
	ToolResult,
	TrajectoryStep,
	TrajectoryLabel,
	CollectedTrajectory,
	ManifestEntry,
	TrajectoryManifest,
	ExportFormat,
	SFTSample,
	DPOPair,
	GRPOSample,
	CollectOptions,
	ExportOptions,
} from "./types.js";
