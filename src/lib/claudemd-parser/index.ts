/**
 * @fusion-code/claudemd-parser — standalone CLAUDE.md parsing library.
 *
 * Re-exports portable parsing functions for external consumers
 * (e.g., Fusion Studio) without pulling in CLI dependencies.
 *
 * Usage:
 *   import { parseFrontmatter, getProjectContextPortable, scanMemoryFiles } from '@fusion-code/claudemd-parser'
 */

// Memory scanning
export {
	formatMemoryManifest,
	type MemoryHeader,
	scanMemoryFiles,
} from "../../memdir/memoryScan.js";

// Memory types
export {
	MEMORY_DRIFT_CAVEAT,
	MEMORY_FRONTMATTER_EXAMPLE,
	MEMORY_TYPES,
	type MemoryType,
	parseMemoryType,
	TRUSTING_RECALL_SECTION,
	TYPES_SECTION_COMBINED,
	TYPES_SECTION_INDIVIDUAL,
	WHAT_NOT_TO_SAVE_SECTION,
	WHEN_TO_ACCESS_SECTION,
} from "../../memdir/memoryTypes.js";
// Portable project context
export {
	getMemoryFilesPortable,
	getProjectContextPortable,
	type PortableMemoryFileInfo,
	type PortableProjectContext,
} from "../../utils/claudemdPortable.js";
// Frontmatter parsing
export {
	coerceDescriptionToString,
	FRONTMATTER_REGEX,
	type FrontmatterData,
	type FrontmatterShell,
	type ParsedMarkdown,
	parseBooleanFrontmatter,
	parseFrontmatter,
	parsePositiveIntFromFrontmatter,
	parseShellFrontmatter,
	splitPathInFrontmatter,
} from "../../utils/frontmatterParser.js";
