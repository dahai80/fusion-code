import { dirname } from "path";
import { logEvent } from "src/services/analytics/index.js";
import { diagnosticTracker } from "../../services/diagnosticTracking.js";
import { clearDeliveredDiagnosticsForFile } from "../../services/lsp/LSPDiagnosticRegistry.js";
import { getLspServerManager } from "../../services/lsp/manager.js";
import { notifyVscodeFileUpdated } from "../../services/mcp/index.js";
import { checkTeamMemSecrets } from "../../services/teamMemorySync/teamMemSecretGuard.js";
import {
	activateConditionalSkillsForPaths,
	addSkillDirectories,
	discoverSkillDirsForPaths,
} from "../../skills/loadSkillsDir.js";
import type { ToolUseContext } from "../../Tool.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { getCwd } from "../../utils/cwd.js";
import { logForDebugging } from "../../utils/debug.js";
import { countLinesChanged } from "../../utils/diff.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { isENOENT } from "../../utils/errors.js";
import {
	FILE_NOT_FOUND_CWD_NOTE,
	findSimilarFile,
	getFileModificationTime,
	suggestPathUnderCwd,
	writeTextContent,
} from "../../utils/file.js";
import {
	fileHistoryEnabled,
	fileHistoryTrackEdit,
} from "../../utils/fileHistory.js";
import { logFileOperation } from "../../utils/fileOperationAnalytics.js";
import {
	type LineEndingType,
	readFileSyncWithMetadata,
} from "../../utils/fileRead.js";
import { getFsImplementation } from "../../utils/fsOperations.js";
import { logError } from "../../utils/log.js";
import { expandPath } from "../../utils/path.js";
import {
	checkWritePermissionForTool,
	matchingRuleForInput,
} from "../../utils/permissions/filesystem.js";
import type { PermissionDecision } from "../../utils/permissions/PermissionResult.js";
import { matchWildcardPattern } from "../../utils/permissions/shellRuleMatching.js";
import type { FileEdit } from "../FileEditTool/types.js";
import {
	findActualString,
	getPatchForEdits,
	preserveQuoteStyle,
} from "../FileEditTool/utils.js";
import { NOTEBOOK_EDIT_TOOL_NAME } from "../NotebookEditTool/constants.js";
import {
	MULTI_EDIT_MAX_EDITS,
	MULTI_EDIT_TOOL_NAME,
	MULTI_EDIT_UNEXPECTEDLY_MODIFIED_ERROR,
} from "./constants.js";
import { getMultiEditToolDescription } from "./prompt.js";
import type { MultiEditInput, MultiEditOutput } from "./types.js";
import { inputSchema, outputSchema } from "./types.js";

const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024;

export const MultiEditTool = buildTool({
	name: MULTI_EDIT_TOOL_NAME,
	searchHint: "apply multiple edits across files",
	maxResultSizeChars: 100_000,
	strict: true,
	async description() {
		return "A tool for editing multiple files at once";
	},
	async prompt() {
		return getMultiEditToolDescription();
	},
	userFacingName: () => "MultiEdit",
	getToolUseSummary(input: MultiEditInput) {
		const files = [...new Set(input.edits.map((e) => e.file_path))];
		if (files.length === 1) {
			return files[0];
		}
		return `${files.length} files`;
	},
	getActivityDescription(input: MultiEditInput) {
		const summary = MultiEditTool.getToolUseSummary(input);
		return `Editing ${summary}`;
	},
	get inputSchema() {
		return inputSchema();
	},
	get outputSchema() {
		return outputSchema();
	},
	toAutoClassifierInput(input: MultiEditInput) {
		return input.edits.map((e) => `${e.file_path}: ${e.new_string}`).join("\n");
	},
	getPath(input: MultiEditInput): string {
		return input.edits[0]?.file_path ?? "";
	},
	backfillObservableInput(input: MultiEditInput) {
		for (const edit of input.edits) {
			if (typeof edit.file_path === "string") {
				edit.file_path = expandPath(edit.file_path);
			}
		}
	},
	async preparePermissionMatcher({ edits }: MultiEditInput) {
		const paths = edits.map((e) => e.file_path);
		return (pattern: string) =>
			paths.some((p) => matchWildcardPattern(pattern, p));
	},
	async checkPermissions(
		input: MultiEditInput,
		context: ToolUseContext,
	): Promise<PermissionDecision> {
		const appState = context.getAppState();
		return checkWritePermissionForTool(
			MultiEditTool,
			input,
			appState.toolPermissionContext,
		);
	},
	renderToolUseMessage(
		{ edits }: MultiEditInput,
		{ verbose }: { verbose: boolean },
	) {
		const files = [...new Set(edits.map((e) => e.file_path))];
		return `${files.length} file${files.length > 1 ? "s" : ""}, ${edits.length} edit${edits.length > 1 ? "s" : ""}`;
	},
	renderToolResultMessage(
		data: MultiEditOutput,
		_progress: unknown[],
		{ verbose }: { verbose: boolean },
	) {
		const succeeded = data.results.filter((r) => r.success).length;
		const failed = data.results.filter((r) => !r.success).length;
		const parts: string[] = [];
		if (succeeded > 0) {
			parts.push(`${succeeded} edit${succeeded > 1 ? "s" : ""} applied`);
		}
		if (failed > 0) {
			parts.push(`${failed} edit${failed > 1 ? "s" : ""} failed`);
		}
		return parts.join(", ") || "No edits applied";
	},
	renderToolUseRejectedMessage(input: MultiEditInput, _options: unknown) {
		return `MultiEdit rejected (${input.edits.length} edits)`;
	},
	renderToolUseErrorMessage(result: unknown, _options: unknown) {
		return `Error in MultiEdit: ${String(result)}`;
	},
	async validateInput(input: MultiEditInput, toolUseContext: ToolUseContext) {
		if (input.edits.length > MULTI_EDIT_MAX_EDITS) {
			return {
				result: false,
				behavior: "ask" as const,
				message: `Too many edits. Maximum is ${MULTI_EDIT_MAX_EDITS}, got ${input.edits.length}.`,
				errorCode: 0,
			};
		}

		const appState = toolUseContext.getAppState();
		const fs = getFsImplementation();

		for (const edit of input.edits) {
			const fullFilePath = expandPath(edit.file_path);

			const secretError = checkTeamMemSecrets(fullFilePath, edit.new_string);
			if (secretError) {
				return { result: false, message: secretError, errorCode: 0 };
			}

			if (edit.old_string === edit.new_string) {
				return {
					result: false,
					behavior: "ask" as const,
					message: `No changes to make in ${edit.file_path}: old_string and new_string are exactly the same.`,
					errorCode: 1,
				};
			}

			const denyRule = matchingRuleForInput(
				fullFilePath,
				appState.toolPermissionContext,
				"edit",
				"deny",
			);
			if (denyRule !== null) {
				return {
					result: false,
					behavior: "ask" as const,
					message: `File ${edit.file_path} is in a directory that is denied by your permission settings.`,
					errorCode: 2,
				};
			}

			if (fullFilePath.startsWith("\\\\") || fullFilePath.startsWith("//")) {
				continue;
			}

			try {
				const { size } = await fs.stat(fullFilePath);
				if (size > MAX_EDIT_FILE_SIZE) {
					return {
						result: false,
						behavior: "ask" as const,
						message: `File ${edit.file_path} is too large to edit.`,
						errorCode: 10,
					};
				}
			} catch (e) {
				if (!isENOENT(e)) {
					throw e;
				}
			}

			if (fullFilePath.endsWith(".ipynb")) {
				return {
					result: false,
					behavior: "ask" as const,
					message: `File ${edit.file_path} is a Jupyter Notebook. Use the ${NOTEBOOK_EDIT_TOOL_NAME} to edit this file.`,
					errorCode: 5,
				};
			}

			const readTimestamp = toolUseContext.readFileState.get(fullFilePath);
			if (!readTimestamp || readTimestamp.isPartialView) {
				return {
					result: false,
					behavior: "ask" as const,
					message: `File ${edit.file_path} has not been read yet. Read it first before writing to it.`,
					errorCode: 6,
				};
			}
		}

		return { result: true };
	},
	inputsEquivalent(input1: MultiEditInput, input2: MultiEditInput) {
		if (input1.edits.length !== input2.edits.length) return false;
		return input1.edits.every((e1, i) => {
			const e2 = input2.edits[i];
			return (
				e2 &&
				e1.file_path === e2.file_path &&
				e1.old_string === e2.old_string &&
				e1.new_string === e2.new_string &&
				(e1.replace_all ?? false) === (e2.replace_all ?? false)
			);
		});
	},
	async call(
		input: MultiEditInput,
		{
			readFileState,
			userModified,
			updateFileHistoryState,
			dynamicSkillDirTriggers,
		},
		_,
		parentMessage,
	) {
		const fs = getFsImplementation();
		const cwd = getCwd();
		const results: MultiEditOutput["results"] = [];

		const editsByFile = new Map<string, typeof input.edits>();
		for (const edit of input.edits) {
			const absPath = expandPath(edit.file_path);
			const existing = editsByFile.get(absPath) ?? [];
			existing.push(edit);
			editsByFile.set(absPath, existing);
		}

		for (const [absoluteFilePath, fileEdits] of editsByFile) {
			try {
				if (!isEnvTruthy(process.env.FUSION_CODE_SIMPLE)) {
					const newSkillDirs = await discoverSkillDirsForPaths(
						[absoluteFilePath],
						cwd,
					);
					if (newSkillDirs.length > 0) {
						for (const dir of newSkillDirs) {
							dynamicSkillDirTriggers?.add(dir);
						}
						addSkillDirectories(newSkillDirs).catch(() => {});
					}
					activateConditionalSkillsForPaths([absoluteFilePath], cwd);
				}

				await diagnosticTracker.beforeFileEdited(absoluteFilePath);
				await fs.mkdir(dirname(absoluteFilePath));

				if (fileHistoryEnabled()) {
					await fileHistoryTrackEdit(
						updateFileHistoryState,
						absoluteFilePath,
						parentMessage.uuid,
					);
				}

				const {
					content: originalFileContents,
					fileExists,
					encoding,
					lineEndings: endings,
				} = readFileForEdit(absoluteFilePath);

				if (fileExists) {
					const lastWriteTime = getFileModificationTime(absoluteFilePath);
					const lastRead = readFileState.get(absoluteFilePath);
					if (!lastRead || lastWriteTime > lastRead.timestamp) {
						const isFullRead =
							lastRead &&
							lastRead.offset === undefined &&
							lastRead.limit === undefined;
						const contentUnchanged =
							isFullRead && originalFileContents === lastRead.content;
						if (!contentUnchanged) {
							throw new Error(MULTI_EDIT_UNEXPECTEDLY_MODIFIED_ERROR);
						}
					}
				}

				const fileEditsResolved: FileEdit[] = fileEdits.map((edit) => {
					const actualOldString =
						findActualString(originalFileContents, edit.old_string) ||
						edit.old_string;
					const actualNewString = preserveQuoteStyle(
						edit.old_string,
						actualOldString,
						edit.new_string,
					);
					return {
						old_string: actualOldString,
						new_string: actualNewString,
						replace_all: edit.replace_all ?? false,
					};
				});

				const { patch, updatedFile } = getPatchForEdits({
					filePath: absoluteFilePath,
					fileContents: originalFileContents,
					edits: fileEditsResolved,
				});

				// #176: delegate disk-write to executor subprocess (fail-open to in-process)
				const {
					callWriteViaExecutor,
				} = require("../../services/executor/executorDriver.js");
				const writeResult = await callWriteViaExecutor({
					filePath: absoluteFilePath,
					content: updatedFile,
					encoding,
					endings,
				});
				if (writeResult === null) {
					writeTextContent(absoluteFilePath, updatedFile, encoding, endings);
				}

				const lspManager = getLspServerManager();
				if (lspManager) {
					clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`);
					lspManager
						.changeFile(absoluteFilePath, updatedFile)
						.catch((err: Error) => {
							logForDebugging(
								`LSP: Failed to notify server of file change for ${absoluteFilePath}: ${err.message}`,
							);
							logError(err);
						});
					lspManager.saveFile(absoluteFilePath).catch((err: Error) => {
						logForDebugging(
							`LSP: Failed to notify server of file save for ${absoluteFilePath}: ${err.message}`,
						);
						logError(err);
					});
				}

				notifyVscodeFileUpdated(
					absoluteFilePath,
					originalFileContents,
					updatedFile,
				);

				readFileState.set(absoluteFilePath, {
					content: updatedFile,
					timestamp: getFileModificationTime(absoluteFilePath),
					offset: undefined,
					limit: undefined,
				});

				countLinesChanged(patch);
				for (const edit of fileEdits) {
					logFileOperation({
						operation: "edit",
						tool: "MultiEditTool",
						filePath: absoluteFilePath,
					});
				}

				logEvent("tengu_multi_edit", {
					editCount: fileEdits.length,
					fileCount: editsByFile.size,
				});

				for (const edit of fileEdits) {
					results.push({
						filePath: edit.file_path,
						success: true,
					});
				}
			} catch (err) {
				logError(err as Error);
				for (const edit of fileEdits) {
					results.push({
						filePath: edit.file_path,
						success: false,
						error: (err as Error).message,
					});
				}
			}
		}

		return { data: { results } };
	},
	mapToolResultToToolResultBlockParam(data: MultiEditOutput, toolUseID) {
		const succeeded = data.results.filter((r) => r.success);
		const failed = data.results.filter((r) => !r.success);

		const parts: string[] = [];
		if (succeeded.length > 0) {
			const fileGroups = new Map<string, number>();
			for (const r of succeeded) {
				fileGroups.set(r.filePath, (fileGroups.get(r.filePath) ?? 0) + 1);
			}
			const fileSummaries = [...fileGroups.entries()]
				.map(([f, c]) => `${f} (${c} edit${c > 1 ? "s" : ""})`)
				.join(", ");
			parts.push(
				`Applied ${succeeded.length} edit${succeeded.length > 1 ? "s" : ""} to ${fileSummaries}`,
			);
		}
		if (failed.length > 0) {
			const errors = failed.map((r) => `${r.filePath}: ${r.error}`).join("; ");
			parts.push(`Failed: ${errors}`);
		}

		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: parts.join(". ") || "No edits applied",
		};
	},
} satisfies ToolDef<ReturnType<typeof inputSchema>, MultiEditOutput>);

function readFileForEdit(absoluteFilePath: string): {
	content: string;
	fileExists: boolean;
	encoding: BufferEncoding;
	lineEndings: LineEndingType;
} {
	try {
		const meta = readFileSyncWithMetadata(absoluteFilePath);
		return {
			content: meta.content,
			fileExists: true,
			encoding: meta.encoding,
			lineEndings: meta.lineEndings,
		};
	} catch (e) {
		if (isENOENT(e)) {
			return {
				content: "",
				fileExists: false,
				encoding: "utf8",
				lineEndings: "LF",
			};
		}
		throw e;
	}
}
