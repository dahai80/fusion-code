export function getCompressionStrategySection(): string {
    return `# Context compression strategies

## When to compress
 - When the conversation exceeds the model's effective context window
 - When the user invokes /compact
 - When response quality degrades (repeated information, forgotten context)
 - Before starting a new major task phase

## Compression levels
 - Light: Remove verbose tool outputs, keep decisions and file references
 - Medium: Summarize conversation segments, keep key decisions and open questions
 - Heavy: Extract only active task state, current file context, and pending actions

## What to preserve (always)
 - Current task description and success criteria
 - File paths and line numbers being actively edited
 - Unresolved errors or blockers
 - User-stated preferences and constraints
 - Import/dependency relationships between files being modified
 - Test expectations and verification criteria

## What to discard
 - Full file contents that can be re-read
 - Detailed tool output that has been acted on
 - Exploration paths that led nowhere
 - Repeated or redundant messages
 - Historical debugging steps once the fix is applied

## Compression format
Use structured summaries, not prose:
- Task: [description] | Status: [state] | Files: [paths]
- Decision: [what was decided] | Reason: [why] | Alternative: [what was rejected]
- Error: [what failed] | Root cause: [why] | Fix: [what was done]
- Pending: [what's left] | Blocked by: [what] | Next: [action]

## Multi-layer compression
For very long conversations, apply compression in layers:
1. First pass: Remove exact tool outputs, keep summaries
2. Second pass: Merge related conversation segments
3. Third pass: Extract only state that affects future actions
4. Final: Produce a single compact state document

## Compression awareness in code
When writing code that will be evaluated in a compressed context:
- Use descriptive names (compressible to references)
- Add comments for non-obvious decisions (survive compression)
- Structure code so the important parts are at the top
- Avoid deep nesting that becomes unclear without full context`
}

export function getContextWindowSection(): string {
    return `# Context window management

## Token budget awareness
 - Track approximate token usage throughout the conversation
 - Reserve 20% of context for the model's response
 - When approaching limits, proactively suggest compression
 - Prioritize active code and recent decisions over historical exploration

## Strategic context loading
 - Load file contents only when needed (lazy loading)
 - Use file references (path:line) instead of full contents when possible
 - Summarize explored files rather than keeping their full contents
 - Use Grep/Glob to find specific sections instead of reading entire files

## Cross-turn context persistence
 - Key decisions persist across compression cycles
 - File modification state must be tracked (what was read, what was changed)
 - Test results and verification status persist
 - Unresolved issues and their context persist

## Context for different model sizes
 - Small models (1-7B): Keep context under 2K tokens, focus on immediate task
 - Medium models (14-27B): Keep context under 8K tokens, include recent decisions
 - Large models (32B+): Can handle 16K+ tokens, include broader project context

## Memory vs context
 - Use project memory (CLAUDE.md, .claude/) for persistent knowledge
 - Use conversation context for active task state
 - After completing a task, save important discoveries to memory
 - Before starting a task, check memory for relevant past context`
}

export function getSmartRetrievalSection(): string {
    return `# Smart information retrieval

## Search-before-read pattern
 - Use Glob to find files before reading them
 - Use Grep to find relevant sections before reading entire files
 - Use workspaceSymbol to locate symbols before diving into code
 - Use findReferences to understand impact before making changes

## Progressive context building
1. Start with the broad picture: project structure, key files
2. Narrow to the specific subsystem: relevant modules and their interfaces
3. Focus on the specific code: functions, classes, data flow
4. Load only what's needed for the current step

## Caching strategies
 - Remember file contents read in the current turn
 - Don't re-read files that haven't been modified
 - Use LSP hover for quick type checks instead of full file reads
 - Track which files have been modified to invalidate cached knowledge

## Avoiding context bloat
 - Don't read entire large files when a targeted search suffices
 - Don't include full stack traces when the relevant line is clear
 - Don't copy-paste large code blocks — reference by file:line
 - Don't keep exploration dead ends in context`
}
