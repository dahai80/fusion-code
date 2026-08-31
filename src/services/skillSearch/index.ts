// #203 Phase B (audit 1.1.3): skillSearch public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). All 7 skillSearch files are public surface
// (each has at least 1 external consumer). `isSkillSearchEnabled` is defined
// in BOTH featureCheck (canonical) and localSearch (local fallback) — re-export
// featureCheck's as the canonical name, localSearch's aliased to avoid the
// export * collision (TS2308).
export * from "./featureCheck.js";
export {
	clearSkillIndexCache,
	getSkillIndex,
	isSkillSearchEnabled as isSkillSearchEnabledLocal,
	SkillIndex,
	searchSkills,
} from "./localSearch.js";
export * from "./prefetch.js";
export * from "./remoteSkillLoader.js";
export * from "./remoteSkillState.js";
export * from "./signals.js";
export * from "./telemetry.js";
