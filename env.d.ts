declare const MACRO: {
	VERSION: string;
	BUILD_TIME: string;
	PACKAGE_URL?: string;
	NATIVE_PACKAGE_URL?: string;
	FEEDBACK_CHANNEL?: string;
	ISSUES_EXPLAINER?: string;
	VERSION_CHANGELOG?: string;
};

declare module "*.node" {
	const value: unknown;
	export default value;
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
	export type ComputerExecutor = {
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
	};
	export type DisplayGeometry = {
		width: number;
		height: number;
		scaleFactor: number;
		x?: number;
		y?: number;
	};
	export type FrontmostApp = {
		bundleId: string;
		displayName?: string;
		name?: string;
		pid?: number;
	};
	export type InstalledApp = {
		bundleId: string;
		displayName?: string;
		path?: string;
	};
	export type RunningApp = { bundleId: string; displayName?: string };
	export type ScreenshotResult = {
		base64?: string;
		data?: string;
		width: number;
		height: number;
		displayId?: number;
	};
	export type ResolvePrepareCaptureResult = {
		hidden: string[];
		activated?: string;
		displayId?: number;
		geometry?: DisplayGeometry;
	};
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
	export type ComputerUseHostAdapter = {
		serverName: string;
		logger: Logger;
		executor: any;
		ensureOsPermissions: () => Promise<{
			granted: boolean;
			accessibility?: boolean;
			screenRecording?: boolean;
		}>;
		isDisabled: () => boolean;
		getSubGates: () => any;
		getAutoUnhideEnabled: () => boolean;
		cropRawPatch: () => null;
	};

	// Re-export Logger so it's available from this module too
	export type Logger = {
		silly(message: string, ...args: unknown[]): void;
		debug(message: string, ...args: unknown[]): void;
		info(message: string, ...args: unknown[]): void;
		warn(message: string, ...args: unknown[]): void;
		error(message: string, ...args: unknown[]): void;
	};
}

declare module "image-processor-napi" {
	export function processImage(
		input: Buffer | Uint8Array,
		options?: Record<string, unknown>,
	): Promise<Buffer>;
}

declare module "url-handler-napi" {
	export function registerHandler(callback: (url: string) => void): void;
	export function unregisterHandler(): void;
}

declare module "modifiers-napi" {
	export function getModifiers(): number;
}

declare module "audio-capture-napi" {
	export function startCapture(
		options?: Record<string, unknown>,
	): Promise<unknown>;
	export function stopCapture(): Promise<void>;
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
	export type ComputerUseAPI = ComputerUseAPI;
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

declare module "@ant/claude-for-chrome-mcp" {
	const _mod: unknown;
	export default _mod;
}

declare module "@ant/computer-use-mcp/sentinelApps" {
	export const sentinelAppNames: string[];
	export const SENTINEL_APPS: string[];
}

declare module "react/compiler-runtime" {
	export function c(size: number): any[];
}

declare module "audio-capture-napi" {
	export function startCapture(
		options?: Record<string, unknown>,
	): Promise<unknown>;
	export function stopCapture(): Promise<Buffer>;
}

// Stripped internal modules from Anthropic fork
declare module "./utils/debug.js" {
	export function logForDebugging(
		message: string,
		options?: { level?: string },
	): void;
}
declare module "../utils/debug.js" {
	export function logForDebugging(
		message: string,
		options?: { level?: string },
	): void;
}
declare module "../utils/envUtils.js" {
	export function getClaudeConfigHomeDir(): string;
	export function isEnvTruthy(key: string): boolean;
}
declare module "./sdk/settingsTypes.generated.js" {
	export type Settings = Record<string, unknown>;
}

// Anthropic documentation stubs (stripped from fork)
declare module "./claude-api/*" {
	const content: string;
	export default content;
}
declare module "../claude-api/*" {
	const content: string;
	export default content;
}

// Stripped server infrastructure
declare module "./server/*" {
	export default undefined;
}
declare module "./server/*.js" {
	export default undefined;
}

// Stripped Anthropic-only modules (1-2 references each)
declare module "*.md" {
	const content: string;
	export default content;
}

declare namespace NodeJS {
	interface ProcessEnv {
		USER_TYPE?: "external" | "ant";
	}
}

// Stripped Anthropic-only runtime functions
declare function fireCompanionObserver(
	messages: unknown,
	callback: (reaction: unknown) => void,
): Promise<void>;

declare module "./services/skillSearch/prefetch.js" {
	export function startSkillDiscoveryPrefetch(
		_arg: null,
		messages: unknown[],
		ctx: unknown,
	): unknown;
	export function collectSkillDiscoveryPrefetch(
		prefetch: unknown,
	): Promise<unknown[]>;
}

// Missing modules for src/main.tsx — using wildcard relative paths
// (relative module declarations resolve from the .d.ts location, which is the project root)
declare module "*/utils/eventLoopStallDetector.js" {
	export function startEventLoopStallDetector(): void;
}
declare module "*/utils/sdkHeapDumpMonitor.js" {
	export function startSdkMemoryMonitor(): void;
}
declare module "*/utils/sessionDataUploader.js" {
	export function createSessionTurnUploader(): unknown;
}
declare module "*/bridge/bridgeMain.js" {
	export function bridgeMain(args: string[]): Promise<void>;
}
declare module "*/utils/ccshareResume.js" {
	export function parseCcshareId(input: string): string | undefined;
	export function loadCcshare(
		id: string,
		opts?: { print?: string | boolean; outputFormat: string },
	): Promise<unknown>;
}

// log: fix TS2339 — ink custom JSX intrinsic elements
declare namespace JSX {
	interface IntrinsicElements {
		"ink-box": Record<string, unknown>;
		"ink-text": Record<string, unknown>;
		"ink-link": Record<string, unknown>;
		"ink-raw-ansi": Record<string, unknown>;
	}
}
