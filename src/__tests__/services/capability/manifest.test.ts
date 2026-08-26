import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllBaseTools } from "../../../tools.js";
import {
	isCapabilityManifestEnabled,
	type CapabilityManifestOptions,
} from "../../../services/capability/runtime.js";

// Mock getCommands + loadAllPlugins before importing manifest (pure-mapping test,
// avoid auth env + disk/network). getAllBaseTools stays real (sync, env-only).
const mockGetCommands = mock<(cwd: string) => Promise<unknown[]>>(
	async () => MOCK_COMMANDS,
);
const mockLoadAllPlugins = mock<
	() => Promise<{ enabled: unknown[]; disabled: unknown[]; errors: unknown[] }>
>(async () => ({
	enabled: MOCK_ENABLED_PLUGINS,
	disabled: MOCK_DISABLED_PLUGINS,
	errors: [],
}));

await mock.module("../../../commands.js", () => ({
	getCommands: mockGetCommands,
}));
await mock.module("../../../utils/plugins/pluginLoader.js", () => ({
	loadAllPlugins: mockLoadAllPlugins,
}));

const { exportCapabilityManifest } = await import(
	"../../../services/capability/manifest.js"
);

// 受控 Command fixtures (shape 匹配 types/command.ts Command 联合)。
const MOCK_COMMANDS = [
	{
		name: "bundled-skill-1",
		description: "a bundled skill",
		type: "prompt",
		source: "bundled",
		contentLength: 42,
		allowedTools: ["Read"],
	 isEnabled: () => true,
	},
	{
		name: "user-skill-1",
		description: "a dir skill",
		type: "prompt",
		source: "skills",
		contentLength: 10,
	},
	{
		name: "local-cmd",
		description: "a local command",
		type: "local",
		isEnabled: () => true,
	},
	{
		name: "hidden-cmd",
		description: "hidden",
		type: "local-jsx",
		isHidden: true,
	},
];

const MOCK_ENABLED_PLUGINS = [
	{
		name: "marketplace-plugin",
		source: "marketplace",
		enabled: true,
		manifest: { version: "1.2.0", description: "a plugin" },
	},
];
const MOCK_DISABLED_PLUGINS = [
	{
		name: "builtin-plugin",
		source: "builtin",
		enabled: false,
		isBuiltin: true,
		manifest: { version: "0.1.0" },
	},
];

const ORIG_CAP = process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED;
let tmpCwd: string;

beforeEach(() => {
	delete process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED;
	tmpCwd = mkdtempSync(join(tmpdir(), "cap-test-"));
	mockGetCommands.mockClear();
	mockLoadAllPlugins.mockClear();
});

afterEach(() => {
	if (ORIG_CAP === undefined)
		delete process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED;
	else
		process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED = ORIG_CAP;
	rmSync(tmpCwd, { recursive: true, force: true });
});

const baseOpts = (
	overrides?: Partial<CapabilityManifestOptions>,
): CapabilityManifestOptions => ({
	cwd: tmpCwd,
	generatedAt: "2026-08-26T00:00:00.000Z",
	...overrides,
});

describe("P5.5 capability manifest — runtime gate", () => {
	test("isCapabilityManifestEnabled defaults to false (byte-identical off)", () => {
		expect(isCapabilityManifestEnabled()).toBe(false);
	});

	test('isCapabilityManifestEnabled true only when env === "1"', () => {
		process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED = "1";
		expect(isCapabilityManifestEnabled()).toBe(true);
	});

	test("isCapabilityManifestEnabled false on truthy-but-not-1 (strict opt-in)", () => {
		process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED = "true";
		expect(isCapabilityManifestEnabled()).toBe(false);
		process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED = "0";
		expect(isCapabilityManifestEnabled()).toBe(false);
	});
});

describe("P5.5 capability manifest — export shape", () => {
	test("schemaVersion is 1, carries cwd + generatedAt", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.schemaVersion).toBe(1);
		expect(m.cwd).toBe(tmpCwd);
		expect(m.generatedAt).toBe("2026-08-26T00:00:00.000Z");
	});

	test("totals reflect entry array lengths", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.totals.tools).toBe(m.tools.length);
		expect(m.totals.commands).toBe(m.commands.length);
		expect(m.totals.skills).toBe(m.skills.length);
		expect(m.totals.plugins).toBe(m.plugins.length);
	});

	test("every tool entry has kind tool + name + enabled", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.tools.length).toBeGreaterThan(0);
		for (const t of m.tools) {
			expect(t.kind).toBe("tool");
			expect(typeof t.name).toBe("string");
			expect(t.name.length).toBeGreaterThan(0);
			expect(typeof t.enabled).toBe("boolean");
		}
	});

	test("tool entries match getAllBaseTools count", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.tools.length).toBe(getAllBaseTools().length);
	});

	test("tool inputSchema present by default (includeSchemas true)", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		const withSchema = m.tools.filter((t) => t.inputSchema !== undefined);
		// 非 MCP 工具经 zodToJsonSchema 应都有 schema; MCP 工具可能 inputJSONSchema。
		expect(withSchema.length).toBeGreaterThan(0);
	});

	test("includeSchemas=false omits all inputSchema", async () => {
		const m = await exportCapabilityManifest(baseOpts({ includeSchemas: false }));
		for (const t of m.tools) {
			expect(t.inputSchema).toBeUndefined();
		}
	});

	test("includeSkills=false skips getCommands call + empties commands/skills", async () => {
		const m = await exportCapabilityManifest(baseOpts({ includeSkills: false }));
		expect(m.commands.length).toBe(0);
		expect(m.skills.length).toBe(0);
		expect(m.totals.commands).toBe(0);
		expect(m.totals.skills).toBe(0);
		expect(mockGetCommands).not.toHaveBeenCalled();
	});

	test("plugins loaded + partitioned enabled/disabled", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.plugins.length).toBe(2);
		const names = m.plugins.map((p) => p.name).sort();
		expect(names).toEqual(["builtin-plugin", "marketplace-plugin"]);
		const enabled = m.plugins.find((p) => p.name === "marketplace-plugin");
		expect(enabled?.enabled).toBe(true);
		expect(enabled?.version).toBe("1.2.0");
		expect(enabled?.description).toBe("a plugin");
		const builtin = m.plugins.find((p) => p.name === "builtin-plugin");
		expect(builtin?.isBuiltin).toBe(true);
		expect(builtin?.enabled).toBe(false);
	});

	test("includePlugins=false skips loadAllPlugins + empties plugins", async () => {
		const m = await exportCapabilityManifest(baseOpts({ includePlugins: false }));
		expect(m.plugins.length).toBe(0);
		expect(m.totals.plugins).toBe(0);
		expect(mockLoadAllPlugins).not.toHaveBeenCalled();
	});
});

describe("P5.5 capability manifest — command/skill partition", () => {
	test("prompt-type commands with bundled/skills source land in skills array", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.skills.length).toBe(2);
		for (const s of m.skills) {
			expect(s.kind).toBe("command");
			expect(s.type).toBe("prompt");
		}
		const skillNames = m.skills.map((s) => s.name).sort();
		expect(skillNames).toEqual(["bundled-skill-1", "user-skill-1"]);
		// bundled-skill-1 携带 contentLength + allowedTools (PromptCommand 字段)。
		const b1 = m.skills.find((s) => s.name === "bundled-skill-1");
		expect(b1?.contentLength).toBe(42);
		expect(b1?.allowedTools).toEqual(["Read"]);
	});

	test("non-prompt commands land in commands array, no prompt leaks", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		expect(m.commands.length).toBe(2);
		const cmdNames = m.commands.map((c) => c.name).sort();
		expect(cmdNames).toEqual(["hidden-cmd", "local-cmd"]);
		for (const c of m.commands) {
			if (c.type) expect(c.type).not.toBe("prompt");
		}
	});
});

describe("P5.5 capability manifest — JSON serializable", () => {
	test("manifest round-trips through JSON.stringify/parse", async () => {
		const m = await exportCapabilityManifest(baseOpts());
		const json = JSON.stringify(m);
		expect(typeof json).toBe("string");
		const back = JSON.parse(json) as typeof m;
		expect(back.schemaVersion).toBe(1);
		expect(back.totals.tools).toBe(m.totals.tools);
	});
});
