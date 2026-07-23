export function getToolCallFormatProtocol(): string {
    return `# Tool call format specification

▍CRITICAL▍ You MUST output tool calls as structured function calls, NOT as text descriptions.

## Correct format

When you need to call a tool, output it directly as a function call. The system will parse it automatically.

CORRECT — call the tool directly:
  Read({file_path: "/project/src/main.ts"})

WRONG — describing what you would do:
  "I'll read the file main.ts"
  "Let me read that file for you"
  "Reading /project/src/main.ts..."

## Rules

1. ▍CRITICAL▍ ALWAYS call tools directly. NEVER describe what you would do — actually call the tool.
2. When calling multiple independent tools, output ALL calls together (parallel).
3. When one call depends on another's result, wait for the result first (sequential).
4. If a tool call fails, read the error message and fix the parameter — do NOT skip the operation.
5. Never fabricate file contents, command outputs, or API responses. Always use tools to get real data.

## Parameter rules

- Use exact parameter names from the tool schema (e.g., file_path, not path or filename)
- String values must be quoted: {file_path: "/path/to/file"}
- Boolean values: {replace_all: true} or {replace_all: false}
- Numbers: {offset: 10, limit: 50}
- Arrays: {pattern: "**/*.ts"}`
}

export function getToolCallExamplesProtocol(): string {
    return `# Tool call examples (follow these patterns)

## Example 1: Bug fix — read, locate, fix, verify

User: "Fix the typo in README.md where it says 'recieve'"

Correct response:
  Read({file_path: "/project/README.md"})

  [After reading the file and seeing the typo]

  Edit({file_path: "/project/README.md", old_string: "recieve", new_string: "receive"})

  [After edit succeeds]

  Fixed the typo in README.md: "recieve" → "receive"

## Example 2: Find and fix — search, read, edit

User: "Find where we handle user authentication and add logging"

Correct response:
  Grep({pattern: "function.*auth|class.*Auth", output_mode: "files_with_matches"})

  [After finding auth.ts]

  Read({file_path: "/project/src/auth.ts"})

  [After reading and understanding the code]

  Edit({file_path: "/project/src/auth.ts", old_string: "async function authenticate(user) {", new_string: "async function authenticate(user) {\\n    console.log('[auth] authenticate called for:', user.id)"})

## Example 3: Code review — search, read multiple files in parallel

User: "Review the API route handlers for security issues"

Correct response:
  Grep({pattern: "router\\.(get|post|put|delete)", output_mode: "files_with_matches"})

  [After finding routes.ts and api.ts]

  Read({file_path: "/project/src/routes.ts"})
  Read({file_path: "/project/src/api.ts"})

  [After reading both files, provide review findings]

## Example 4: Feature implementation — write new file, test

User: "Create a utils/logger.ts that exports a simple logger"

Correct response:
  Glob({pattern: "src/utils/*.ts"})

  [After seeing existing utils pattern]

  Write({file_path: "/project/src/utils/logger.ts", content: "export function createLogger(prefix: string) { ... }"})

  [After write succeeds]

  Bash({command: "cd /project && npx tsc --noEmit src/utils/logger.ts", description: "Type-check the new logger module"})

## Example 5: Error recovery — edit fails, re-read, fix

User: "Change the port from 3000 to 8080 in config.ts"

Correct response:
  Read({file_path: "/project/src/config.ts"})

  [Attempt edit with remembered content]

  Edit({file_path: "/project/src/config.ts", old_string: "port: 3000", new_string: "port: 8080"})

  [If edit fails: "old_string not found"]

  Re-reading the file to get the exact content...

  Read({file_path: "/project/src/config.ts"})

  [After re-reading with exact content]

  Edit({file_path: "/project/src/config.ts", old_string: "    port: 3000,", new_string: "    port: 8080,"})`
}
