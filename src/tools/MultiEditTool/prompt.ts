import { isCompactLinePrefixEnabled } from "../../utils/file.js";
import { FILE_READ_TOOL_NAME } from "../FileReadTool/prompt.js";

function getPreReadInstruction(): string {
	return `\n- You must use your \`${FILE_READ_TOOL_NAME}\` tool at least once in the conversation before editing each file. This tool will error if you attempt an edit without reading the file. `;
}

export function getMultiEditToolDescription(): string {
	const prefixFormat = isCompactLinePrefixEnabled()
		? "line number + tab"
		: "spaces + line number + arrow";
	return `Performs multiple exact string replacements across one or more files in a single tool call. More efficient than calling Edit multiple times when you need to make several changes at once.

Usage:${getPreReadInstruction()}
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- Each edit in the array is independent: specify file_path, old_string, new_string, and optional replace_all.
- Edits targeting the same file are applied sequentially in array order. If one edit fails, the rest for that file are skipped.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.

Common patterns:
- Fix typos across multiple files: MultiEdit({edits: [{file_path: "/project/a.ts", old_string: "recieve", new_string: "receive"}, {file_path: "/project/b.ts", old_string: "recieve", new_string: "receive"}]})
- Rename a variable in one file and update an import in another: MultiEdit({edits: [{file_path: "/project/src/api.ts", old_string: "oldName", new_string: "newName", replace_all: true}, {file_path: "/project/src/index.ts", old_string: "import { oldName } from './api'", new_string: "import { newName } from './api'"}]})
- Apply multiple changes to the same file: MultiEdit({edits: [{file_path: "/project/src/handler.ts", old_string: "function handler() {", new_string: "async function handler() {"}, {file_path: "/project/src/handler.ts", old_string: "return null", new_string: "return { status: 'ok' }"}]})

Troubleshooting:
- If old_string is not unique: include more surrounding lines to make it unique, or use replace_all
- If the file was modified since you last read it: re-read the file and retry with updated content
- If indentation doesn't match: copy the exact text from Read output, stripping only the line number prefix`;
}
