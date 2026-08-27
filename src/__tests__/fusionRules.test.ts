import { beforeEach, describe, expect, it } from "bun:test";
import {
	isToolDenied,
	mergeFusionRulesConfigs,
	parseFusionRulesFrontmatter,
	setFusionRulesConfig,
} from "../utils/fusionRules.js";

describe("parseFusionRulesFrontmatter", () => {
	it("parses valid denied_tools array", () => {
		const result = parseFusionRulesFrontmatter({
			denied_tools: ["Bash", "WebSearch"],
		});
		expect(result.deniedTools).toEqual(["Bash", "WebSearch"]);
	});

	it("filters non-string entries from denied_tools", () => {
		const result = parseFusionRulesFrontmatter({
			denied_tools: ["Bash", 123, null],
		});
		expect(result.deniedTools).toEqual(["Bash"]);
	});

	it("defaults denied_tools to empty array when not an array", () => {
		const result = parseFusionRulesFrontmatter({ denied_tools: "Bash" });
		expect(result.deniedTools).toEqual([]);
	});

	it("defaults denied_tools to empty array when missing", () => {
		const result = parseFusionRulesFrontmatter({});
		expect(result.deniedTools).toEqual([]);
	});

	it("parses default_template string", () => {
		const result = parseFusionRulesFrontmatter({
			default_template: "bug-fix",
		});
		expect(result.defaultTemplate).toBe("bug-fix");
	});

	it("defaults default_template to null for non-string", () => {
		const result = parseFusionRulesFrontmatter({ default_template: 42 });
		expect(result.defaultTemplate).toBeNull();
	});

	it("handles empty frontmatter", () => {
		const result = parseFusionRulesFrontmatter({});
		expect(result.deniedTools).toEqual([]);
		expect(result.defaultTemplate).toBeNull();
	});
});

describe("isToolDenied", () => {
	beforeEach(() => {
		setFusionRulesConfig({ deniedTools: [], defaultTemplate: null });
	});

	it("returns true when tool is in denied list", () => {
		setFusionRulesConfig({
			deniedTools: ["WebSearch", "Bash"],
			defaultTemplate: null,
		});
		expect(isToolDenied("WebSearch")).toBe(true);
		expect(isToolDenied("Bash")).toBe(true);
	});

	it("returns false when tool is not in denied list", () => {
		setFusionRulesConfig({
			deniedTools: ["WebSearch"],
			defaultTemplate: null,
		});
		expect(isToolDenied("Read")).toBe(false);
	});

	it("returns false with empty deniedTools", () => {
		setFusionRulesConfig({ deniedTools: [], defaultTemplate: null });
		expect(isToolDenied("WebSearch")).toBe(false);
	});

	it("performs case-insensitive matching", () => {
		setFusionRulesConfig({
			deniedTools: ["WebSearch"],
			defaultTemplate: null,
		});
		expect(isToolDenied("websearch")).toBe(true);
			expect(isToolDenied("WEBSEARCH")).toBe(true);
			expect(isToolDenied("WebSearch")).toBe(true);
	});
});

describe("mergeFusionRulesConfigs", () => {
	it("deduplicates deniedTools across configs", () => {
		const merged = mergeFusionRulesConfigs([
			{ deniedTools: ["Bash"], defaultTemplate: "global" },
			{ deniedTools: ["Bash", "WebSearch"], defaultTemplate: "project" },
		]);
		expect(merged.deniedTools).toEqual(["Bash", "WebSearch"]);
		// P2-13: defaultTemplate first-wins — global (earliest) wins, aligning
		// with CLAUDE.md doc priority (global rules highest). configs ordered
		// [global, project, ...] descending priority.
		expect(merged.defaultTemplate).toBe("global");
	});

	it("preserves defaultTemplate when later config has null", () => {
		const merged = mergeFusionRulesConfigs([
			{ deniedTools: [], defaultTemplate: "global" },
			{ deniedTools: [], defaultTemplate: null },
		]);
		expect(merged.defaultTemplate).toBe("global");
	});

	it("returns empty config for empty list", () => {
		const merged = mergeFusionRulesConfigs([]);
		expect(merged.deniedTools).toEqual([]);
		expect(merged.defaultTemplate).toBeNull();
	});

	it("single config passes through", () => {
		const merged = mergeFusionRulesConfigs([
			{ deniedTools: ["Bash"], defaultTemplate: "tpl" },
		]);
		expect(merged.deniedTools).toEqual(["Bash"]);
		expect(merged.defaultTemplate).toBe("tpl");
	});
});
