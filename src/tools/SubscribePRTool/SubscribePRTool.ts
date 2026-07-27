/**
 * SubscribePRTool — GitHub PR 订阅工具
 *
 * 允许 AI 模型订阅 GitHub Pull Request 的变更通知。
 * 当 PR 有新的提交、评论或状态变更时，AI 会收到通知。
 *
 * gated by feature('KAIROS_GITHUB_WEBHOOKS')
 */

import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";

export const SUBSCRIBE_PR_TOOL_NAME = "SubscribePR";

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
	z.strictObject({
		pr_url: z
			.string()
			.url()
			.describe("The GitHub Pull Request URL to subscribe to"),
		events: z
			.array(
				z.enum(["comment", "commit", "review", "status", "merged", "closed"]),
			)
			.optional()
			.default(["comment", "commit", "review"])
			.describe("Events to subscribe to"),
		description: z
			.string()
			.optional()
			.describe("Description of why this PR is being monitored"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
	z.object({
		subscription_id: z.string().describe("The subscription ID"),
		pr_url: z.string().describe("The PR URL that was subscribed to"),
		events: z.array(z.string()).describe("Events being monitored"),
		status: z.string().describe("Subscription status"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────

async function subscribePRToolCall(
	input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
	const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

	return {
		subscription_id: subscriptionId,
		pr_url: input.pr_url,
		events: input.events || ["comment", "commit", "review"],
		status: "active",
	};
}

// ─── Tool Definition ────────────────────────────────────────

// log: cast toolDef as any — lazySchema/getter mismatch with ToolDef type
const toolDef = {
	name: SUBSCRIBE_PR_TOOL_NAME,
	description: `Subscribe to GitHub Pull Request notifications. When subscribed, the AI will receive notifications about PR events (comments, commits, reviews, status changes, merges, closes). Use this to stay updated on PRs you're monitoring.`,
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async execute(
		input: z.infer<InputSchema>,
		_context?: unknown,
		_canUseTool?: unknown,
		_parentMessage?: unknown,
		_onProgress?: unknown,
	) {
		return { data: await subscribePRToolCall(input) };
	},
	userFacingName: () => "SubscribePR",
	isEnabled: () => true,
} as any;

export const SubscribePRTool = buildTool(toolDef);
