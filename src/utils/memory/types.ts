import { feature } from "bun:bundle";

// Config-based memory types for memory directory discovery.
// Distinct from src/memdir/memoryTypes.ts (file-based frontmatter types:
// 'user', 'feedback', 'project', 'reference') — these two enums serve
// different subsystems and are intentionally independent.
export const MEMORY_TYPE_VALUES = [
	"User",
	"Project",
	"Local",
	"Managed",
	"AutoMem",
	"FusionRules",
	...(feature("TEAMMEM") ? (["TeamMem"] as const) : []),
] as const;

export type MemoryType = (typeof MEMORY_TYPE_VALUES)[number];
