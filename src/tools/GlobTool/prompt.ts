export const GLOB_TOOL_NAME = 'Glob'

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead

Pattern reference:
- "*" matches any sequence of characters within a single path segment
- "**" matches any number of path segments (including zero)
- "*.ts" matches all .ts files in the working directory
- "**/*.ts" matches all .ts files in any subdirectory
- "src/**/*.test.ts" matches test files under src/
- "{ts,tsx}" matches either "ts" or "tsx" (brace expansion)

Common use cases:
- Find all source files: Glob({pattern: "src/**/*.{ts,tsx}"})
- Find configuration files: Glob({pattern: "*config*"})
- Find test files: Glob({pattern: "**/*.test.*"})
- Find files in a specific directory: Glob({pattern: "packages/core/src/**/*.ts"})

Tips:
- Start with a broad pattern and narrow down if you get too many results
- Use brace expansion for multiple extensions: "*.{js,jsx,ts,tsx}"
- If you need to search file contents, use Grep instead
- If you need both file names and content, use Glob to find files, then Grep to search within them`
