import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const { BaseToolsCapability } = await import(
	"../../../../services/llm/capabilities/tools.js"
);
const {
	getFusionRulesConfig,
	setFusionRulesConfig,
} = await import("../../../../utils/fusionRules.js");

let savedConfig: ReturnType<typeof getFusionRulesConfig>;

beforeEach(() => {
	// snapshot the shared denied-tools registry so a denial set in one test
	// doesn't leak into another (isToolDenied reads the module-global).
	savedConfig = getFusionRulesConfig();
});

afterEach(() => {
	setFusionRulesConfig(savedConfig);
});

describe("BaseToolsCapability.list", () => {
	test("returns ≥1 enabled tool name (Bash always enabled)", () => {
		const cap = new BaseToolsCapability();
		const names = cap.list();
		expect(names.length).toBeGreaterThan(0);
		expect(names).toContain("Bash");
	});

	test("provider is base", () => {
		expect(new BaseToolsCapability().provider).toBe("base");
	});
});

describe("BaseToolsCapability.getTool", () => {
	test("getTool('Bash') returns a defined Tool", () => {
		const cap = new BaseToolsCapability();
		const tool = cap.getTool("Bash");
		expect(tool).toBeDefined();
		expect(tool?.name).toBe("Bash");
	});

	test("getTool unknown name returns undefined", () => {
		const cap = new BaseToolsCapability();
		expect(cap.getTool("__nope_not_a_tool__")).toBeUndefined();
	});
});

describe("BaseToolsCapability.isDenied", () => {
	test("returns false for non-denied tool", () => {
		const cap = new BaseToolsCapability();
		expect(cap.isDenied("Bash")).toBe(false);
	});

	test("returns true when tool added to denied registry", () => {
		const cap = new BaseToolsCapability();
		setFusionRulesConfig({
			deniedTools: ["WebSearch"],
			defaultTemplate: null,
		});
		expect(cap.isDenied("WebSearch")).toBe(true);
	});

	test("denial is case-insensitive", () => {
		const cap = new BaseToolsCapability();
		setFusionRulesConfig({
			deniedTools: ["WebSearch"],
			defaultTemplate: null,
		});
		expect(cap.isDenied("websearch")).toBe(true);
		expect(cap.isDenied("WEBSEARCH")).toBe(true);
	});
});
