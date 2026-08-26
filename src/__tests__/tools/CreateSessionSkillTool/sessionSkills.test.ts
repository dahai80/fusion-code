import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	clearDynamicSkills,
	createSkillCommand,
	getDynamicSkills,
	registerDynamicSkill,
} from "../../../skills/loadSkillsDir.js";
import {
	isSessionSkillsEnabled,
	isValidSessionSkillName,
	MAX_SESSION_SKILL_BODY,
	MAX_SESSION_SKILL_NAME,
} from "../../../tools/CreateSessionSkillTool/runtime.js";
import type { PromptCommand } from "../../../types/command.js";

const ORIG_SESSION_SKILLS = process.env.FUSION_CODE_SESSION_SKILLS_ENABLED;

beforeEach(() => {
	delete process.env.FUSION_CODE_SESSION_SKILLS_ENABLED;
	clearDynamicSkills();
});

afterEach(() => {
	if (ORIG_SESSION_SKILLS === undefined)
		delete process.env.FUSION_CODE_SESSION_SKILLS_ENABLED;
	else process.env.FUSION_CODE_SESSION_SKILLS_ENABLED = ORIG_SESSION_SKILLS;
	clearDynamicSkills();
});

describe("P5.4 session skills — runtime gate", () => {
	test("isSessionSkillsEnabled defaults to false (byte-identical off)", () => {
		expect(isSessionSkillsEnabled()).toBe(false);
	});

	test('isSessionSkillsEnabled true only when env === "1"', () => {
		process.env.FUSION_CODE_SESSION_SKILLS_ENABLED = "1";
		expect(isSessionSkillsEnabled()).toBe(true);
	});

	test("isSessionSkillsEnabled false on truthy-but-not-1 (strict opt-in)", () => {
		process.env.FUSION_CODE_SESSION_SKILLS_ENABLED = "true";
		expect(isSessionSkillsEnabled()).toBe(false);
		process.env.FUSION_CODE_SESSION_SKILLS_ENABLED = "0";
		expect(isSessionSkillsEnabled()).toBe(false);
	});
});

describe("P5.4 session skills — name validation", () => {
	test("accepts lowercase kebab-case", () => {
		expect(isValidSessionSkillName("my-proc")).toBe(true);
		expect(isValidSessionSkillName("a")).toBe(true);
		expect(isValidSessionSkillName("abc123")).toBe(true);
		expect(isValidSessionSkillName("a-b-c-1")).toBe(true);
	});

	test("rejects uppercase", () => {
		expect(isValidSessionSkillName("MyProc")).toBe(false);
		expect(isValidSessionSkillName("my-Proc")).toBe(false);
	});

	test("rejects leading hyphen", () => {
		expect(isValidSessionSkillName("-proc")).toBe(false);
		expect(isValidSessionSkillName("--x")).toBe(false);
	});

	test("rejects spaces, underscores, dots, slashes", () => {
		expect(isValidSessionSkillName("my proc")).toBe(false);
		expect(isValidSessionSkillName("my_proc")).toBe(false);
		expect(isValidSessionSkillName("my.proc")).toBe(false);
		expect(isValidSessionSkillName("my/proc")).toBe(false);
	});

	test("rejects names exceeding max length", () => {
		const ok = "a".repeat(MAX_SESSION_SKILL_NAME);
		expect(isValidSessionSkillName(ok)).toBe(true);
		const tooLong = "a".repeat(MAX_SESSION_SKILL_NAME + 1);
		expect(isValidSessionSkillName(tooLong)).toBe(false);
	});

	test("rejects empty name", () => {
		expect(isValidSessionSkillName("")).toBe(false);
	});
});

// Helper: build an in-memory skill Command like CreateSessionSkillTool.execute does.
function makeSkill(name: string, description = "test skill") {
	return createSkillCommand({
		skillName: name,
		displayName: name,
		description,
		hasUserSpecifiedDescription: true,
		markdownContent: "# do thing\n\nstep 1",
		allowedTools: [],
		disallowedTools: [],
		argumentHint: undefined,
		argumentNames: [],
		whenToUse: undefined,
		version: undefined,
		model: undefined,
		disableModelInvocation: false,
		userInvocable: true,
		source: "bundled",
		baseDir: undefined,
		loadedFrom: "skills",
		hooks: undefined,
		executionContext: "inline",
		agent: undefined,
		paths: undefined,
		effort: undefined,
		shell: undefined,
	});
}

describe("P5.4 session skills — in-memory dynamicSkills map", () => {
	test("registered skill visible via getDynamicSkills", () => {
		const before = getDynamicSkills().length;
		registerDynamicSkill(makeSkill("my-proc"));
		const after = getDynamicSkills();
		expect(after.length).toBe(before + 1);
		const found = after.find((s) => s.name === "my-proc");
		expect(found).toBeDefined();
		expect(found?.type).toBe("prompt");
		expect(found?.description).toBe("test skill");
	});

	test("registerDynamicSkill returns false on first insert, true on replace", () => {
		expect(registerDynamicSkill(makeSkill("dup"))).toBe(false);
		expect(registerDynamicSkill(makeSkill("dup", "replaced"))).toBe(true);
		const skills = getDynamicSkills();
		const found = skills.find((s) => s.name === "dup");
		expect(found?.description).toBe("replaced");
	});

	test("replace overwrites body (markdownContent)", () => {
		registerDynamicSkill(makeSkill("with-body"));
		const first = getDynamicSkills().find((s) => s.name === "with-body");
		expect((first as PromptCommand | undefined)?.contentLength).toBeGreaterThan(
			0,
		);
		// replace with longer body
		const longer = createSkillCommand({
			skillName: "with-body",
			displayName: "with-body",
			description: "d",
			hasUserSpecifiedDescription: true,
			markdownContent: "# x\n".repeat(50),
			allowedTools: [],
			disallowedTools: [],
			argumentHint: undefined,
			argumentNames: [],
			whenToUse: undefined,
			version: undefined,
			model: undefined,
			disableModelInvocation: false,
			userInvocable: true,
			source: "bundled",
			baseDir: undefined,
			loadedFrom: "skills",
			hooks: undefined,
			executionContext: "inline",
			agent: undefined,
			paths: undefined,
			effort: undefined,
			shell: undefined,
		});
		registerDynamicSkill(longer);
		const after = getDynamicSkills().find((s) => s.name === "with-body");
		expect((after as PromptCommand | undefined)?.contentLength).toBe(
			"# x\n".repeat(50).length,
		);
	});

	test("non-persistent: clearDynamicSkills wipes all", () => {
		registerDynamicSkill(makeSkill("a"));
		registerDynamicSkill(makeSkill("b"));
		expect(getDynamicSkills().length).toBeGreaterThanOrEqual(2);
		clearDynamicSkills();
		expect(getDynamicSkills().length).toBe(0);
	});

	test("distinct names coexist", () => {
		registerDynamicSkill(makeSkill("one"));
		registerDynamicSkill(makeSkill("two"));
		registerDynamicSkill(makeSkill("three"));
		const names = getDynamicSkills()
			.map((s) => s.name)
			.filter((n) => ["one", "two", "three"].includes(n));
		expect(names.sort()).toEqual(["one", "three", "two"]);
	});
});

describe("P5.4 session skills — body limits", () => {
	test("MAX_SESSION_SKILL_BODY is a sane upper bound", () => {
		expect(MAX_SESSION_SKILL_BODY).toBeGreaterThan(1000);
		expect(MAX_SESSION_SKILL_BODY).toBeLessThanOrEqual(1_000_000);
	});
});
