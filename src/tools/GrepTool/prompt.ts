import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'

export const GREP_TOOL_NAME = 'Grep'

export function getDescription(): string {
  return `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use ${GREP_TOOL_NAME} for search tasks. NEVER invoke \`grep\` or \`rg\` as a ${BASH_TOOL_NAME} command. The ${GREP_TOOL_NAME} tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use ${AGENT_TOOL_NAME} tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`

  Common patterns:
  - Find function definitions: Grep({pattern: "function \\w+|const \\w+ = \\(|export function", output_mode: "content"})
  - Find all imports of a module: Grep({pattern: "from 'react'", output_mode: "files_with_matches"})
  - Find TODO/FIXME comments: Grep({pattern: "TODO|FIXME|HACK|XXX", output_mode: "content"})
  - Find class usage: Grep({pattern: "class User|new User", glob: "*.ts"})
  - Find string literals: Grep({pattern: '"error"|"Error"', output_mode: "content"})

  Tips:
  - Start with output_mode: "files_with_matches" to scope the search, then use "content" to see specific lines
  - Use glob to narrow search scope for faster results: Grep({pattern: "TODO", glob: "src/**/*.ts"})
  - For exact word matches, use word boundaries: Grep({pattern: "\\bUser\\b"}) avoids matching "UserService"
  - Escape special regex characters: . * + ? [ ] ( ) { } | ^ $ \\
  - If you need to find files by name, use Glob instead`
}
