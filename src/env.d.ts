// Local type stubs for exports stripped from the Anthropic SDK fork.
// These are type-only declarations; no runtime code is generated.

// Missing export from src/utils/betas.js
declare module "../../utils/betas.js" {
	export function getBedrockExtraBodyParamsBetas(): string[];
}

// log: stub for TS2307 — @anthropic-ai/mcpb external package
declare module "@anthropic-ai/mcpb/dist/schemas/any.js" {
	import type { ZodTypeAny } from "zod/v4";
	export const McpbManifestSchema: ZodTypeAny;
}

declare module "@ant/computer-use-mcp" {
	export const API_RESIZE_PARAMS: Record<string, unknown>;
	export function targetImageSize(
		physW: number,
		physH: number,
		params: Record<string, unknown>,
	): [number, number];
	export function buildComputerUseTools(
		capabilities: any,
		coordinateMode: any,
		installedAppNames?: string[],
	): any[];
	export function createComputerUseMcpServer(
		adapter: any,
		coordinateMode: any,
	): any;
	export function bindSessionContext(
		adapter: any,
		coordinateMode: any,
		ctx: any,
	): (name: string, args: unknown) => Promise<any>;
	export type ComputerUseSessionContext = Record<string, unknown>;
	export type CuCallToolResult = {
		content: any[];
		isError?: boolean;
		telemetry?: { error_kind?: string };
	};
	export type CuPermissionRequest = {
		toolName: string;
		input: Record<string, unknown>;
	};
	export type CuPermissionResponse = {
		granted: any[];
		denied: any[];
		flags: any;
	};
	export const DEFAULT_GRANT_FLAGS: any;
	export type ScreenshotDims = {
		width: number;
		height: number;
		displayWidth?: number;
		displayHeight?: number;
		displayId?: number;
		originX?: number;
		originY?: number;
	};
	export interface ComputerExecutor {
		capabilities: any;
		prepareForAction(
			allowlistBundleIds: string[],
			displayId?: number,
		): Promise<string[]>;
		previewHideSet(
			allowlistBundleIds: string[],
			displayId?: number,
		): Promise<Array<{ bundleId: string; displayName: string }>>;
		getDisplaySize(displayId?: number): Promise<DisplayGeometry>;
		listDisplays(): Promise<DisplayGeometry[]>;
		findWindowDisplays(
			bundleIds: string[],
		): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
		resolvePrepareCapture(opts: any): Promise<ResolvePrepareCaptureResult>;
		screenshot(opts: any): Promise<ScreenshotResult>;
		zoom(
			regionLogical: any,
			allowedBundleIds: string[],
			displayId?: number,
		): Promise<{ base64: string; width: number; height: number }>;
		key(keySequence: string, repeat?: number): Promise<void>;
		holdKey(keyNames: string[], durationMs: number): Promise<void>;
		type(text: string, opts: { viaClipboard: boolean }): Promise<void>;
		readClipboard(): Promise<string>;
		writeClipboard(text: string): Promise<void>;
		moveMouse(x: number, y: number): Promise<void>;
		click(
			x: number,
			y: number,
			button: string,
			count: number,
			modifiers?: string[],
		): Promise<void>;
		mouseDown(): Promise<void>;
		mouseUp(): Promise<void>;
		getCursorPosition(): Promise<{ x: number; y: number }>;
		drag(from: any, to: any): Promise<void>;
		scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
		getFrontmostApp(): Promise<FrontmostApp | null>;
		appUnderPoint(
			x: number,
			y: number,
		): Promise<{ bundleId: string; displayName: string } | null>;
		listInstalledApps(): Promise<InstalledApp[]>;
		getAppIcon(path: string): Promise<string | undefined>;
		listRunningApps(): Promise<RunningApp[]>;
		openApp(bundleId: string): Promise<void>;
	}
	export interface DisplayGeometry {
		width: number;
		height: number;
		scaleFactor: number;
		x?: number;
		y?: number;
	}
	export interface FrontmostApp {
		bundleId: string;
		name?: string;
		pid?: number;
		displayName?: string;
	}
	export interface InstalledApp {
		bundleId: string;
		name?: string;
		displayName?: string;
		path?: string;
	}
	export interface ResolvePrepareCaptureResult {
		displayId?: number;
		geometry?: DisplayGeometry;
		hidden: string[];
		activated?: string;
	}
	export interface RunningApp {
		pid?: number;
		bundleId: string;
		name?: string;
		displayName?: string;
	}
	export interface ScreenshotResult {
		data?: Buffer;
		displayId?: number;
		width: number;
		height: number;
		base64?: string;
	}
}

declare module "@ant/computer-use-mcp/sentinelApps" {
	export function getSentinelCategory(appName: string): string | null;
	export const sentinelAppNames: string[];
	export const SENTINEL_APPS: string[];
}

declare module "@ant/computer-use-input" {
	interface ComputerUseInputAPI {
		moveMouse(x: number, y: number, animated: boolean): Promise<void>;
		mouseLocation(): Promise<{ x: number; y: number }>;
		mouseButton(button: string, action: string, count?: number): Promise<void>;
		mouseScroll(delta: number, direction: string): Promise<void>;
		key(key: string, action: string): Promise<void>;
		keys(parts: string[]): Promise<void>;
		typeText(text: string): Promise<void>;
		getFrontmostAppInfo(): { bundleId: string; appName: string } | null;
	}
	type ComputerUseInput = ComputerUseInputAPI & { isSupported: boolean };
	const _mod: ComputerUseInput;
	export default _mod;
	export type { ComputerUseInput, ComputerUseInputAPI };
}

declare module "@ant/computer-use-mcp/types" {
	export type CoordinateMode = "pixels" | "normalized";
	export type CuSubGates = {
		pixelValidation: boolean;
		clipboardPasteMultiline: boolean;
		mouseAnimation: boolean;
		hideBeforeAction: boolean;
		autoTargetDisplay: boolean;
		clipboardGuard: boolean;
	};
	export interface ComputerUseHostAdapter {
		serverName: string;
		logger: Logger;
		executor: import("@ant/computer-use-mcp").ComputerExecutor;
		ensureOsPermissions: () => Promise<{
			granted: boolean;
			accessibility?: boolean;
			screenRecording?: boolean;
		}>;
		isDisabled: () => boolean;
		getSubGates: () => CuSubGates;
		getAutoUnhideEnabled: () => boolean;
		cropRawPatch: () => null;
	}
	export interface Logger {
		info(msg: string, ...args: unknown[]): void;
		error(msg: string, ...args: unknown[]): void;
		warn(msg: string, ...args: unknown[]): void;
		debug(msg: string, ...args: unknown[]): void;
		silly(msg: string, ...args: unknown[]): void;
	}
	export interface GrantedApp {
		bundleId: string;
		displayName: string;
		grantedAt: Date;
	}
	export interface DeniedApp {
		bundleId: string;
		reason: "user_denied" | "not_installed";
	}
	export interface RequestedApp {
		resolved?: { bundleId: string; displayName: string };
		alreadyGranted?: boolean;
		requestedName: string;
	}
	export interface TccState {
		accessibility: boolean;
		screenRecording: boolean;
	}
	export type GrantFlags = Record<string, boolean>;
	export const DEFAULT_GRANT_FLAGS: GrantFlags;
	export interface CuPermissionRequest {
		apps: RequestedApp[];
		reason?: string;
		requestedFlags: GrantFlags;
		tccState?: TccState;
		willHide?: string[];
	}
	export interface CuPermissionResponse {
		granted: any[];
		denied: any[];
		flags: GrantFlags;
	}
}

declare module "@ant/computer-use-swift" {
	interface ComputerUseAPI {
		apps: {
			prepareDisplay(
				allowlist: string[],
				host: string,
				displayId?: number,
			): Promise<{ hidden: string[]; activated?: string }>;
			previewHideSet(
				allowlist: string[],
				displayId?: number,
			): Promise<Array<{ bundleId: string; displayName: string }>>;
			findWindowDisplays(
				bundleIds: string[],
			): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
			listInstalled(): Promise<
				Array<{ bundleId: string; displayName: string; path: string }>
			>;
			iconDataUrl(path: string): string | null;
			listRunning(): Promise<Array<{ bundleId: string; displayName: string }>>;
			open(bundleId: string): Promise<void>;
			unhide(bundleIds: string[]): Promise<void>;
			appUnderPoint(
				x: number,
				y: number,
			): Promise<{ bundleId: string; displayName: string } | null>;
		};
		display: {
			getSize(displayId?: number): {
				width: number;
				height: number;
				scaleFactor: number;
			};
			listAll(): Array<{ width: number; height: number; scaleFactor: number }>;
		};
		screenshot: {
			captureExcluding(
				allowlist: string[],
				quality: number,
				w: number,
				h: number,
				displayId?: number,
			): Promise<{ base64: string; width: number; height: number }>;
			captureRegion(
				allowlist: string[],
				x: number,
				y: number,
				w: number,
				h: number,
				outW: number,
				outH: number,
				quality: number,
				displayId?: number,
			): Promise<{ base64: string; width: number; height: number }>;
		};
		resolvePrepareCapture(
			allowlist: string[],
			host: string,
			quality: number,
			w: number,
			h: number,
			displayId: number | undefined,
			autoResolve: boolean,
			doHide?: boolean,
		): Promise<{ hidden: string[]; activated?: string }>;
		tcc: {
			checkAccessibility(): boolean;
			checkScreenRecording(): boolean;
		};
		hotkey: {
			registerEscape(callback: () => void): boolean;
			unregister(): void;
			notifyExpectedEscape(): void;
		};
		_drainMainRunLoop(): void;
	}
	const _mod: ComputerUseAPI;
	export default _mod;
	export type { ComputerUseAPI };
}

declare module "@anthropic-ai/mcpb" {
	export type McpbSourceType =
		| { source: "url"; url: string; headers?: Record<string, string> }
		| {
				source: "github";
				repo: string;
				ref?: string;
				path?: string;
				sparsePaths?: string[];
		  }
		| {
				source: "git";
				url: string;
				ref?: string;
				path?: string;
				sparsePaths?: string[];
		  }
		| { source: "npm"; package: string; version?: string }
		| { source: "pypi"; package: string; version?: string }
		| { source: "local"; path: string }
		| { source: "filesystem"; path: string }
		| { source: "mcpb-registry"; id: string; version?: string };

	export interface McpbUserConfigurationOption {
		description: string;
		title: string;
		type: "string" | "number" | "boolean" | "file" | "directory";
		required?: boolean;
		default?: string | number | boolean | string[];
		multiple?: boolean;
		sensitive?: boolean;
		min?: number;
		max?: number;
	}

	export type UserConfigSchema = Record<string, McpbUserConfigurationOption>;

	export interface McpbPluginEntry {
		name: string;
		description: string;
		strict?: boolean;
		userConfig?: UserConfigSchema;
		mcpServers?: Record<string, unknown>;
		hooks?: Record<string, unknown>;
		tags?: string[];
	}

	export interface McpbManifest {
		name: string;
		version?: string;
		display_name?: string;
		description?: string;
		author?: { name: string; email?: string; url?: string };
		owner?: { name: string; email?: string; url?: string };
		plugins?: McpbPluginEntry[];
		forceRemoveDeletedPlugins?: boolean;
		mcpServers?: Record<string, unknown>;
		hooks?: Record<string, unknown>;
		user_config?: UserConfigSchema;
		server?: unknown;
		dxt_version?: string;
		manifest_version?: string;
	}

	export function getMcpConfigForManifest(options: {
		manifest: McpbManifest;
		extensionPath: string;
		systemDirs: unknown;
		userConfig?: Record<string, unknown>;
		pathSeparator?: string;
	}): Promise<Record<string, unknown> | undefined>;
}

declare module "@anthropic-ai/mcpb/dist/types.js" {
	export type McpbManifestAny = import("@anthropic-ai/mcpb").McpbManifest & {
		[key: string]: unknown;
	};
}

// Widen process.env.USER_TYPE from literal "external" (set by build.ts define)
// to string so that comparisons like process.env.USER_TYPE === "ant" don't trigger TS2367.
// The build always sets it to "external", making those branches dead code — but the
// comparison is intentional for the internal build where USER_TYPE is "ant".
declare global {
	namespace NodeJS {
		interface ProcessEnv {
			USER_TYPE?: string;
		}
	}
}
