import { describe, expect, it, mock } from "bun:test";

// insight-0902 G4: readOnly named permission mode.
// Asserts: (1) readOnly in EXTERNAL_PERMISSION_MODES; (2) readOnly denies a
// write tool (isReadOnly=false) whose checkPermissions returns passthrough→ask;
// (3) readOnly lets a read tool (isReadOnly=true) pass through (not a mode-deny);
// (4) baseline default mode does not deny writes (byte-identical). Soft semantics
// (mirrors dontAsk sibling): deny only fires when inner result is "ask" —
// explicit alwaysAllow rules still win. v1 contract.
//
// Mocks: permissions.js loads clean (its import graph is lazy for the ink/
// settings chain). getInitialSettings is stubbed defensively in case any
// transitive load reads it. (E1 lesson: mock.module is global — stub only what
// this test's import chain needs, never shared utils like envUtils/debug.)
//
// Note: the readOnly→default cycle (getNextPermissionMode) is NOT tested here —
// importing getNextPermissionMode pulls permissionSetup.js → gracefulShutdown →
// ink/instances → colorize, which hits a load-time settings TDZ that
// mock.module cannot intercept for deep static-import transitive loads in this
// bun version. The cycle is a 2-line switch case; behavior coverage lives in
// the deny/allow tests below, which exercise the actual permission decision.

await mock.module("../../../utils/settings/settings.js", () => ({
	getInitialSettings: () => ({ prefersReducedMotion: false }),
	getSettingsWithErrors: () => ({ settings: {}, errors: [] }),
}));

import type { AppState } from "../../../state/AppStateStore.js";
import type { Tool, ToolUseContext } from "../../../Tool.js";
import { EXTERNAL_PERMISSION_MODES } from "../../../types/permissions.js";
import { hasPermissionsToUseTool } from "../../../utils/permissions/permissions.js";

function ctxMode(mode: "readOnly" | "default"): ToolUseContext {
	const appState: AppState = {
		toolPermissionContext: {
			mode,
			additionalWorkingDirectories: new Map(),
			alwaysAllowRules: {},
			alwaysDenyRules: {},
			alwaysAskRules: {},
			isBypassPermissionsModeAvailable: false,
		},
	} as unknown as AppState;
	return {
		options: {
			commands: [],
			debug: false,
			mainLoopModel: "test-model",
			tools: [],
			verbose: false,
			thinkingConfig: { type: "disabled" },
			mcpClients: [],
			mcpResources: {},
			isNonInteractiveSession: false,
			agentDefinitions: { tools: [], agents: [] },
		},
		abortController: new AbortController(),
		readFileState: new Map(),
		getAppState: () => appState,
		setAppState: () => {},
	} as unknown as ToolUseContext;
}

function makeTool(opts: { name: string; isReadOnly: boolean }): Tool {
	return {
		name: opts.name,
		inputSchema: { parse: (input: unknown) => input },
		checkPermissions: async () => ({ behavior: "passthrough", message: "" }),
		isReadOnly: () => opts.isReadOnly,
		isConcurrencySafe: () => false,
		isEnabled: () => true,
		requiresUserInteraction: () => false,
		maxResultSizeChars: Infinity,
	} as unknown as Tool;
}

describe("readOnly permission mode (insight-0902 G4)", () => {
	it("includes readOnly in EXTERNAL_PERMISSION_MODES", () => {
		expect(EXTERNAL_PERMISSION_MODES).toContain("readOnly");
	});

	it("denies a write tool (isReadOnly=false) when mode is readOnly", async () => {
		const context = ctxMode("readOnly");
		const writeTool = makeTool({ name: "Edit", isReadOnly: false });
		const decision = await hasPermissionsToUseTool(
			writeTool,
			{ file_path: "/tmp/x", content: "x" },
			context,
			undefined,
			"tu-1",
		);
		expect(decision.behavior).toBe("deny");
		expect(decision.decisionReason).toEqual({
			type: "mode",
			mode: "readOnly",
		});
	});

	it("lets a read tool (isReadOnly=true) pass through in readOnly mode", async () => {
		const context = ctxMode("readOnly");
		const readTool = makeTool({ name: "Read", isReadOnly: true });
		const decision = await hasPermissionsToUseTool(
			readTool,
			{ file_path: "/tmp/x" },
			context,
			undefined,
			"tu-2",
		);
		// Read tool not mode-denied; inner passthrough→ask survives (soft mode).
		expect(decision.behavior).not.toBe("deny");
	});

	it("does not deny write tools when mode is default (byte-identical baseline)", async () => {
		const context = ctxMode("default");
		const writeTool = makeTool({ name: "Edit", isReadOnly: false });
		const decision = await hasPermissionsToUseTool(
			writeTool,
			{ file_path: "/tmp/x", content: "x" },
			context,
			undefined,
			"tu-3",
		);
		expect(decision.behavior).not.toBe("deny");
	});
});
