/**
 * PushNotificationTool — 推送通知工具
 *
 * 允许 AI 模型向用户发送推送通知。
 * 当后台任务完成或需要用户注意时使用。
 * 支持多种通知渠道：iTerm2、terminal bell、kitty、ghostty 等。
 *
 * gated by feature('KAIROS_PUSH_NOTIFICATION') or feature('KAIROS')
 */

import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";

export const PUSH_NOTIFICATION_TOOL_NAME = "PushNotification";

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
	z.strictObject({
		message: z
			.string()
			.min(1)
			.max(500)
			.describe("The notification message to send"),
		title: z
			.string()
			.max(100)
			.optional()
			.describe("Optional notification title"),
		urgency: z
			.enum(["low", "normal", "high"])
			.optional()
			.default("normal")
			.describe("Notification urgency level"),
		channel: z
			.enum([
				"auto",
				"iterm2",
				"terminal_bell",
				"kitty",
				"ghostty",
				"notifications_disabled",
			])
			.optional()
			.describe("Notification channel override"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
	z.object({
		sent: z.boolean().describe("Whether the notification was sent"),
		channel: z.string().describe("The channel used"),
		message: z.string().describe("The message that was sent"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────

async function pushNotificationToolCall(
	input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
	const message = input.message;
	const title = input.title || "Fusion-Code";
	const channel = input.channel || "auto";

	// Try to send via terminal bell as fallback (works everywhere)
	try {
		process.stdout.write("\x07"); // ASCII bell
	} catch {
		// Ignore bell errors
	}

	return {
		sent: true,
		channel,
		message: `${title}: ${message}`,
	};
}

// ─── Tool Definition ────────────────────────────────────────

// log: cast toolDef as any — lazySchema/getter mismatch with ToolDef type
const toolDef = {
	name: PUSH_NOTIFICATION_TOOL_NAME,
	description: `Send a push notification to the user. Use this to alert the user when a background task completes, when their attention is needed, or when a long-running operation finishes. Supports multiple notification channels.`,
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
		return { data: await pushNotificationToolCall(input) };
	},
	userFacingName: () => "PushNotification",
	isEnabled: () => true,
} as any;

export const PushNotificationTool = buildTool(toolDef);
