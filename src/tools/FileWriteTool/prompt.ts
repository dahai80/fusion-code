import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

export const FILE_WRITE_TOOL_NAME = 'Write'
export const DESCRIPTION = 'Write a file to the local filesystem.'

function getPreReadInstruction(): string {
  return `\n- If this is an existing file, you MUST use the ${FILE_READ_TOOL_NAME} tool first to read the file's contents. This tool will fail if you did not read the file first.`
}

export function getWriteToolDescription(): string {
  return `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.${getPreReadInstruction()}
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.

When to use Write vs Edit:
- Use Write to create NEW files that don't exist yet
- Use Write for complete rewrites where most of the file content changes
- Use Edit for targeted changes (fix a bug, update a function, rename a variable)
- If you're changing less than 50% of the file, prefer Edit

Common patterns:
- Create a new module: Write({file_path: "/project/src/utils.ts", content: "..."})
- Create a config file: Write({file_path: "/project/.env.local", content: "API_KEY=..."})
- Full file rewrite: Write({file_path: "/project/src/generated-types.ts", content: "..."})

Important:
- The file_path must be an absolute path, not a relative path
- Ensure parent directories exist before writing (use Bash with mkdir -p if needed)
- Never write binary content — only text files
- The content parameter replaces the entire file contents`
}
