import { isCompactLinePrefixEnabled } from '../../utils/file.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

function getPreReadInstruction(): string {
  return `\n- You must use your \`${FILE_READ_TOOL_NAME}\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. `
}

export function getEditToolDescription(): string {
  return getDefaultEditDescription()
}

function getDefaultEditDescription(): string {
  const prefixFormat = isCompactLinePrefixEnabled()
    ? 'line number + tab'
    : 'spaces + line number + arrow'
  const minimalUniquenessHint =
    process.env.USER_TYPE === 'ant'
      ? `\n- Use the smallest old_string that's clearly unique — usually 2-4 adjacent lines is sufficient. Avoid including 10+ lines of context when less uniquely identifies the target.`
      : ''
  return `Performs exact string replacements in files.

Usage:${getPreReadInstruction()}
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.${minimalUniquenessHint}
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.

Common patterns:
- Fix a typo: Edit({file_path: "/project/README.md", old_string: "recieve", new_string: "receive"})
- Rename a variable everywhere: Edit({file_path: "/project/src/api.ts", old_string: "oldName", new_string: "newName", replace_all: true})
- Replace a function body: Edit({file_path: "/project/src/handler.ts", old_string: "function handler() {\\n  return null\\n}", new_string: "function handler() {\\n  return { status: 'ok' }\\n}"})
- Add an import: Edit({file_path: "/project/src/index.ts", old_string: "import { foo } from './bar'", new_string: "import { foo, bar } from './bar'"})
- Remove a line: Edit({file_path: "/project/src/main.ts", old_string: "console.log('debug')\\n", new_string: ""})

Troubleshooting:
- If old_string is not unique: include more surrounding lines to make it unique, or use replace_all
- If the file was modified since you last read it: re-read the file and retry with updated content
- If indentation doesn't match: copy the exact text from Read output, stripping only the line number prefix`
}
