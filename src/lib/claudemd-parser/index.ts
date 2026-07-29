/**
 * @fusion-code/claudemd-parser — standalone CLAUDE.md parsing library.
 *
 * Re-exports portable parsing functions for external consumers
 * (e.g., Fusion Studio) without pulling in CLI dependencies.
 *
 * Usage:
 *   import { parseFrontmatter, getProjectContextPortable, scanMemoryFiles } from '@fusion-code/claudemd-parser'
 */

// Frontmatter parsing
export {
    parseFrontmatter,
    splitPathInFrontmatter,
    parsePositiveIntFromFrontmatter,
    coerceDescriptionToString,
    parseBooleanFrontmatter,
    parseShellFrontmatter,
    FRONTMATTER_REGEX,
    type FrontmatterData,
    type ParsedMarkdown,
    type FrontmatterShell,
} from '../../utils/frontmatterParser.js'

// Memory types
export {
    MEMORY_TYPES,
    parseMemoryType,
    TYPES_SECTION_COMBINED,
    TYPES_SECTION_INDIVIDUAL,
    WHAT_NOT_TO_SAVE_SECTION,
    MEMORY_DRIFT_CAVEAT,
    WHEN_TO_ACCESS_SECTION,
    TRUSTING_RECALL_SECTION,
    MEMORY_FRONTMATTER_EXAMPLE,
    type MemoryType,
} from '../../memdir/memoryTypes.js'

// Memory scanning
export {
    scanMemoryFiles,
    formatMemoryManifest,
    type MemoryHeader,
} from '../../memdir/memoryScan.js'

// Portable project context
export {
    getMemoryFilesPortable,
    getProjectContextPortable,
    type PortableMemoryFileInfo,
    type PortableProjectContext,
} from '../../utils/claudemdPortable.js'
