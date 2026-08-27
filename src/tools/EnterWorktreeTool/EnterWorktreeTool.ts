import { z } from "zod/v4";
import { getSessionId, setOriginalCwd } from "../../bootstrap/state.js";
import { clearSystemPromptSections } from "../../constants/systemPromptSections.js";
import { logEvent } from "../../services/analytics/index.js";
import type { Tool } from "../../Tool.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { clearMemoryFileCaches } from "../../utils/claudemd.js";
import { getCwd } from "../../utils/cwd.js";
import { findCanonicalGitRoot } from "../../utils/git.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { logError } from "../../utils/log.js";
import { getPlanSlug, getPlansDirectory } from "../../utils/plans.js";
import { setCwd } from "../../utils/Shell.js";
import { saveWorktreeState } from "../../utils/sessionStorage.js";
import {
	createWorktreeForSession,
	getCurrentWorktreeSession,
	validateWorktreeSlug,
	type WorktreeSession,
} from "../../utils/worktree.js";
import { ENTER_WORKTREE_TOOL_NAME } from "./constants.js";
import { getEnterWorktreeToolPrompt } from "./prompt.js";
import { renderToolResultMessage, renderToolUseMessage } from "./UI.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		name: z
			.string()
			.superRefine((s, ctx) => {
				try {
					validateWorktreeSlug(s);
				} catch (e) {
					ctx.addIssue({ code: "custom", message: (e as Error).message });
				}
			})
			.optional()
			.describe(
				'Optional name for the worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.',
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		worktreePath: z.string(),
		worktreeBranch: z.string().optional(),
		message: z.string(),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type Output = z.infer<OutputSchema>;

export const EnterWorktreeTool: Tool<InputSchema, Output> = buildTool({
	name: ENTER_WORKTREE_TOOL_NAME,
	searchHint: "create an isolated git worktree and switch into it",
	maxResultSizeChars: 100_000,
	async description() {
		return "Creates an isolated worktree (via git or configured hooks) and switches the session into it";
	},
	async prompt() {
		return getEnterWorktreeToolPrompt();
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	userFacingName() {
		return "Creating worktree";
	},
	shouldDefer: true,
	toAutoClassifierInput(input) {
		return input.name ?? "";
	},
	renderToolUseMessage,
	renderToolResultMessage,
	async call(input) {
		// Validate not already in a worktree created by this session
		if (getCurrentWorktreeSession()) {
			throw new Error("Already in a worktree session");
		}

		// P2-20: 捕获调用前 CWD, createWorktreeForSession 抛 (git 锁/盘满/slug 冲突) 时
		// 回滚到调用前 CWD 再 re-throw。原: chdir(mainRepoRoot) 在 create 前, create 抛
		// 则会话留 CWD 移到主仓根 (可能与用户所在地不同) 无 worktree, ExitWorktree 不触发
		// (getCurrentWorktreeSession() null) → 副作用持续。现在 chdir 也包进 try, 失败回滚。
		const prevCwd = getCwd();

		// Resolve to main repo root so worktree creation works from within a worktree
		const mainRepoRoot = findCanonicalGitRoot(getCwd());
		if (mainRepoRoot && mainRepoRoot !== getCwd()) {
			process.chdir(mainRepoRoot);
			setCwd(mainRepoRoot);
		}

		const slug = input.name ?? getPlanSlug();

		let worktreeSession: WorktreeSession;
		try {
			worktreeSession = await createWorktreeForSession(getSessionId(), slug);
		} catch (createError) {
			// 回滚到调用前 CWD — create 失败不应留 chdir 副作用
			try {
				process.chdir(prevCwd);
				setCwd(prevCwd);
			} catch (rollbackErr) {
				logEvent("tengu_worktree_rollback_failed", {});
				logError(rollbackErr as Error);
			}
			throw createError;
		}

		process.chdir(worktreeSession.worktreePath);
		setCwd(worktreeSession.worktreePath);
		setOriginalCwd(getCwd());
		saveWorktreeState(worktreeSession);
		// Clear cached system prompt sections so env_info_simple recomputes with worktree context
		clearSystemPromptSections();
		// Clear memoized caches that depend on CWD
		clearMemoryFileCaches();
		getPlansDirectory.cache.clear?.();

		logEvent("tengu_worktree_created", {
			mid_session: true,
		});

		const branchInfo = worktreeSession.worktreeBranch
			? ` on branch ${worktreeSession.worktreeBranch}`
			: "";

		return {
			data: {
				worktreePath: worktreeSession.worktreePath,
				worktreeBranch: worktreeSession.worktreeBranch,
				message: `Created worktree at ${worktreeSession.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
			},
		};
	},
	mapToolResultToToolResultBlockParam({ message }, toolUseID) {
		return {
			type: "tool_result",
			content: message,
			tool_use_id: toolUseID,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
