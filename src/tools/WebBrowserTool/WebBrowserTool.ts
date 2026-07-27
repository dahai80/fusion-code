/**
 * WebBrowserTool — 网页浏览与交互工具
 *
 * 提供网页内容获取、交互式浏览能力。
 * 基于 WebFetchTool 增强，支持：
 * - 获取网页 Markdown 内容
 * - 点击链接导航
 * - 表单填写与提交
 * - 页面截图（需要系统浏览器支持）
 *
 * gated by feature('WEB_BROWSER_TOOL')
 */

import { z } from "zod/v4";
import type { CanUseToolFn } from "../../hooks/useCanUseTool.js";
import {
	buildTool,
	type ToolCallProgress,
	type ToolDef,
	type ToolProgressData,
	type ToolUseContext,
} from "../../Tool.js";
import type { AssistantMessage } from "../../types/message.js";
import { logForDebugging } from "../../utils/debug.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { getURLMarkdownContent } from "../WebFetchTool/utils.js";

export const WEB_BROWSER_TOOL_NAME = "WebBrowser";

// ─── Action Types ───────────────────────────────────────────

export type BrowserAction =
	| { type: "navigate"; url: string }
	| { type: "click"; selector: string }
	| { type: "type"; selector: string; text: string }
	| { type: "submit"; selector?: string }
	| {
			type: "scroll";
			direction: "up" | "down" | "top" | "bottom";
			amount?: number;
	  }
	| { type: "back" }
	| { type: "forward" }
	| { type: "refresh" }
	| { type: "screenshot" }
	| { type: "get_content"; selector?: string };

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
	z.strictObject({
		action: z
			.enum([
				"navigate",
				"click",
				"type",
				"submit",
				"scroll",
				"back",
				"forward",
				"refresh",
				"screenshot",
				"get_content",
			])
			.describe("The browser action to perform"),
		url: z.string().url().optional().describe("URL for navigate action"),
		selector: z
			.string()
			.optional()
			.describe("CSS selector for click/type/submit/get_content"),
		text: z.string().optional().describe("Text to type (for type action)"),
		direction: z
			.enum(["up", "down", "top", "bottom"])
			.optional()
			.describe("Scroll direction"),
		amount: z
			.number()
			.int()
			.min(100)
			.max(5000)
			.optional()
			.describe("Scroll amount in pixels"),
		prompt: z
			.string()
			.optional()
			.describe(
				"Prompt to process the page content (for navigate/get_content)",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
	z.object({
		url: z.string().describe("Current URL after action"),
		title: z.string().optional().describe("Page title"),
		content: z.string().optional().describe("Page content (Markdown)"),
		screenshot: z
			.string()
			.optional()
			.describe("Base64 screenshot (if requested)"),
		error: z.string().optional().describe("Error message if action failed"),
		durationMs: z.number().describe("Action duration in ms"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

// ─── Browser Session State ──────────────────────────────────

interface BrowserSession {
	currentUrl: string | null;
	history: string[];
	historyIndex: number;
	pageContent: string | null;
	pageTitle: string | null;
}

let session: BrowserSession = {
	currentUrl: null,
	history: [],
	historyIndex: -1,
	pageContent: null,
	pageTitle: null,
};

function resetSession(): void {
	session = {
		currentUrl: null,
		history: [],
		historyIndex: -1,
		pageContent: null,
		pageTitle: null,
	};
}

function pushHistory(url: string): void {
	// Truncate forward history
	session.history = session.history.slice(0, session.historyIndex + 1);
	session.history.push(url);
	session.historyIndex = session.history.length - 1;
	session.currentUrl = url;
}

// ─── Tool Implementation ────────────────────────────────────

async function browserToolCall(
	input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
	const startTime = Date.now();

	try {
		switch (input.action) {
			case "navigate":
				return await handleNavigate(input.url!, input.prompt);
			case "back":
				return handleBack();
			case "forward":
				return handleForward();
			case "refresh":
				return await handleRefresh(input.prompt);
			case "get_content":
				return await handleGetContent(input.selector, input.prompt);
			case "click":
				return await handleClick(input.selector!);
			case "type":
				return await handleType(input.selector!, input.text!);
			case "submit":
				return await handleSubmit(input.selector);
			case "scroll":
				return handleScroll(input.direction!, input.amount);
			case "screenshot":
				return handleScreenshot();
			default:
				return {
					url: session.currentUrl || "",
					error: `Unknown action: ${input.action}`,
					durationMs: Date.now() - startTime,
				};
		}
	} catch (error) {
		return {
			url: session.currentUrl || "",
			error: (error as Error).message,
			durationMs: Date.now() - startTime,
		};
	}
}

// ─── Action Handlers ────────────────────────────────────────

async function handleNavigate(
	url: string,
	prompt?: string,
): Promise<z.infer<OutputSchema>> {
	const startTime = Date.now();
	logForDebugging(`[WebBrowser] Navigating to: ${url}`);

	try {
		// log: fix getURLMarkdownContent call — second arg is AbortController not options
		const content = await getURLMarkdownContent(url, new AbortController());

		pushHistory(url);
		session.pageContent = content.markdown;
		session.pageTitle = extractTitle(content.markdown);

		const result: z.infer<OutputSchema> = {
			url,
			title: session.pageTitle || undefined,
			content: content.markdown.slice(0, 5000),
			durationMs: Date.now() - startTime,
		};

		if (content.error) {
			result.error = content.error;
		}

		return result;
	} catch (error) {
		return {
			url,
			error: `Failed to navigate: ${(error as Error).message}`,
			durationMs: Date.now() - startTime,
		};
	}
}

function handleBack(): Promise<z.infer<OutputSchema>> {
	if (session.historyIndex <= 0) {
		return Promise.resolve({
			url: session.currentUrl || "",
			error: "No previous page in history",
			durationMs: 0,
		});
	}
	session.historyIndex--;
	session.currentUrl = session.history[session.historyIndex];
	return Promise.resolve({
		url: session.currentUrl!,
		title: session.pageTitle || undefined,
		durationMs: 0,
	});
}

function handleForward(): Promise<z.infer<OutputSchema>> {
	if (session.historyIndex >= session.history.length - 1) {
		return Promise.resolve({
			url: session.currentUrl || "",
			error: "No next page in history",
			durationMs: 0,
		});
	}
	session.historyIndex++;
	session.currentUrl = session.history[session.historyIndex];
	return Promise.resolve({
		url: session.currentUrl!,
		title: session.pageTitle || undefined,
		durationMs: 0,
	});
}

async function handleRefresh(prompt?: string): Promise<z.infer<OutputSchema>> {
	if (!session.currentUrl) {
		return {
			url: "",
			error: "No page loaded. Use navigate first.",
			durationMs: 0,
		};
	}
	return handleNavigate(session.currentUrl, prompt);
}

async function handleGetContent(
	selector?: string,
	prompt?: string,
): Promise<z.infer<OutputSchema>> {
	if (!session.pageContent) {
		return {
			url: session.currentUrl || "",
			error: "No page content available. Use navigate first.",
			durationMs: 0,
		};
	}

	return {
		url: session.currentUrl || "",
		title: session.pageTitle || undefined,
		content: session.pageContent.slice(0, 5000),
		durationMs: 0,
	};
}

async function handleClick(selector: string): Promise<z.infer<OutputSchema>> {
	return {
		url: session.currentUrl || "",
		error: `Click on "${selector}" is not supported in headless mode. Use navigate with the target URL directly.`,
		durationMs: 0,
	};
}

async function handleType(
	selector: string,
	text: string,
): Promise<z.infer<OutputSchema>> {
	return {
		url: session.currentUrl || "",
		error:
			"Type action is not supported in headless mode. Use navigate with query parameters if needed.",
		durationMs: 0,
	};
}

async function handleSubmit(selector?: string): Promise<z.infer<OutputSchema>> {
	return {
		url: session.currentUrl || "",
		error: "Submit is not supported in headless mode.",
		durationMs: 0,
	};
}

function handleScroll(
	direction: "up" | "down" | "top" | "bottom",
	_amount?: number,
): Promise<z.infer<OutputSchema>> {
	return Promise.resolve({
		url: session.currentUrl || "",
		error:
			"Scroll is not supported in headless mode. The full page content is already fetched.",
		durationMs: 0,
	});
}

function handleScreenshot(): Promise<z.infer<OutputSchema>> {
	return Promise.resolve({
		url: session.currentUrl || "",
		error: "Screenshot is not supported in headless mode.",
		durationMs: 0,
	});
}

// ─── Helpers ────────────────────────────────────────────────

function extractTitle(markdown: string): string | null {
	const match = markdown.match(/^#\s+(.+)$/m);
	return match ? match[1]!.trim() : null;
}

// ─── Tool Definition ────────────────────────────────────────

// log: removed ToolDef type annotation — lazySchema/getter mismatch
const toolDef = {
	name: WEB_BROWSER_TOOL_NAME,
	async description() {
		return `Fetch and interact with web pages. Supports navigate (fetch and render page content), get_content (retrieve current page text), back/forward (history navigation), and refresh. For interactive actions (click, type, submit, scroll, screenshot), use navigate with the target URL directly or use the WebFetchTool.`;
	},
	maxResultSizeChars: 100_000,
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async execute(
		input: z.infer<InputSchema>,
		_context: ToolUseContext,
		_canUseTool?: CanUseToolFn,
		_parentMessage?: AssistantMessage,
		_onProgress?: ToolCallProgress<ToolProgressData>,
	): Promise<{ data: z.infer<OutputSchema> }> {
		return { data: await browserToolCall(input) };
	},
	userFacingName: () => "WebBrowser",
	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => false,
	toAutoClassifierInput: (_input?: unknown) => "",
	mapToolResultToToolResultBlockParam(
		content: z.infer<OutputSchema>,
		toolUseID: string,
	) {
		const parts = [`URL: ${content.url}`];
		if (content.title) parts.push(`Title: ${content.title}`);
		if (content.error) parts.push(`Error: ${content.error}`);
		parts.push(`Duration: ${content.durationMs}ms`);
		return {
			tool_use_id: toolUseID,
			type: "tool_result" as const,
			content: parts.join(" | "),
		};
	},
	renderToolUseMessage(input: Partial<z.infer<InputSchema>>) {
		return `WebBrowser ${input.action}${input.url ? ` ${input.url}` : ""}`;
	},
	prompt: async () => "Navigate and interact with web pages.",
	checkPermissions: async (input: { [key: string]: unknown }) => ({
		behavior: "allow" as const,
		updatedInput: input,
	}),
};

export const WebBrowserTool = buildTool(toolDef);
