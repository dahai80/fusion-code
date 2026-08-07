// D1 轨迹飞轮 — 模块统一出口 (issue #50/#51)

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
