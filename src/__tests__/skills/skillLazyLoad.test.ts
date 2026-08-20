import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearSkillCaches,
	createSkillCommand,
	estimateSkillFrontmatterTokens,
	parseSkillFrontmatterFields,
} from "../../skills/loadSkillsDir.js";
import { parseFrontmatter } from "../../utils/frontmatterParser.js";

// 最小 ToolUseContext — 测试 body 无 !`...`/```! 块, executeShellCommandsInPrompt
// 扫描无匹配即 Promise.all([]) 立即返回, 不触达权限/调用路径。getPromptForCommand
// 仍要求传 context, 故给结构合法的最小 stub。
const minimalContext = {
	getAppState: () =>
		({
			toolPermissionContext: { alwaysAllowRules: {} },
		}) as never,
} as never;

function buildSkill(skillFile: string, raw: string) {
	mkdirSync(join(skillFile, ".."), { recursive: true });
	writeFileSync(skillFile, raw);
	const content = readFileSync(skillFile, "utf-8");
	const { frontmatter, content: body } = parseFrontmatter(content, skillFile);
	const parsed = parseSkillFrontmatterFields(frontmatter, body, "t-skill");
	return { parsed, content };
}

// getPromptForCommand 类型签名 = Promise<ContentBlockParam[] | string>, 运行时
// 返回 [{ type: "text", text }]. 提取 text 并收窄, 避免 tsc 对联合类型的报错。
function blockText(r: unknown): string {
	if (typeof r === "string") return r;
	const b = (r as Array<{ type?: string; text?: string }>)[0];
	return b?.text ?? "";
}

describe("skill body-defer 懒加载 (issue #77)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "skill-lazy-"));
		clearSkillCaches();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		clearSkillCaches();
	});

	it("传 skillFilePath 时 contentLength=0 (body 不常驻闭包)", () => {
		const skillDir = join(dir, "my-skill");
		const skillFile = join(skillDir, "SKILL.md");
		const { parsed } = buildSkill(
			skillFile,
			"---\nname: My Skill\n---\n# Body content here\n",
		);

		const cmd = createSkillCommand({
			...parsed,
			skillName: "my-skill",
			skillFilePath: skillFile,
			source: "userSettings",
			baseDir: skillDir,
			loadedFrom: "skills",
			paths: undefined,
		});

		expect(cmd.type).toBe("prompt");
		if (cmd.type !== "prompt") throw new Error("expected prompt");
		expect(cmd.contentLength).toBe(0);
	});

	it("getPromptForCommand 首次 lazy read, 二次命中 memo (不重读)", async () => {
		const skillDir = join(dir, "lazy-skill");
		const skillFile = join(skillDir, "SKILL.md");
		const { parsed } = buildSkill(
			skillFile,
			"---\nname: Lazy\n---\nFirst body version\n",
		);

		const cmd = createSkillCommand({
			...parsed,
			skillName: "lazy-skill",
			skillFilePath: skillFile,
			source: "userSettings",
			baseDir: skillDir,
			loadedFrom: "skills",
			paths: undefined,
		});

		if (cmd.type !== "prompt") throw new Error("expected prompt command");

		const r1 = await cmd.getPromptForCommand("", minimalContext);
		expect(blockText(r1)).toContain("First body version");

		// 改文件后二次调用: body-defer = Promise memo 缓存首次结果, 故二次仍读到
		// 旧内容 (验证 cache 命中、不重读磁盘)。
		writeFileSync(skillFile, "---\nname: Lazy\n---\nSecond body version\n");
		const r2 = await cmd.getPromptForCommand("", minimalContext);
		expect(blockText(r2)).toContain("First body version");
		expect(blockText(r2)).not.toContain("Second body version");
	});

	it("baseDir 前缀 + $ARGUMENTS 替换正确注入 prompt", async () => {
		const skillDir = join(dir, "dir-skill");
		const skillFile = join(skillDir, "SKILL.md");
		const { parsed } = buildSkill(
			skillFile,
			"---\nname: Dir\n---\nHello $ARGUMENTS\n",
		);

		const cmd = createSkillCommand({
			...parsed,
			skillName: "dir-skill",
			skillFilePath: skillFile,
			source: "userSettings",
			baseDir: skillDir,
			loadedFrom: "skills",
			paths: undefined,
		});

		if (cmd.type !== "prompt") throw new Error("expected prompt command");
		const r = await cmd.getPromptForCommand("world", minimalContext);
		expect(blockText(r)).toContain(
			`Base directory for this skill: ${skillDir}`,
		);
		expect(blockText(r)).toContain("Hello world");
	});

	it("无 frontmatter.description 时 fallback 取正文首行", () => {
		const skillDir = join(dir, "nodesc-skill");
		const skillFile = join(skillDir, "SKILL.md");
		const { parsed } = buildSkill(
			skillFile,
			"---\nname: NoDesc\n---\nThis is the first line\n\nMore body\n",
		);

		// extractDescriptionFromMarkdown fallback = 正文首行
		expect(parsed.description).toBe("This is the first line");

		const cmd = createSkillCommand({
			...parsed,
			skillName: "nodesc-skill",
			skillFilePath: skillFile,
			source: "userSettings",
			baseDir: skillDir,
			loadedFrom: "skills",
			paths: undefined,
		});
		expect(cmd.description).toBe("This is the first line");
	});

	it("estimateSkillFrontmatterTokens 不含 body (frontmatter-only)", () => {
		const skillDir = join(dir, "token-skill");
		const skillFile = join(skillDir, "SKILL.md");
		const { parsed } = buildSkill(
			skillFile,
			`---\nname: token\ndescription: a token skill\n---\n${"x".repeat(5000)}\n`,
		);

		const cmd = createSkillCommand({
			...parsed,
			skillName: "token",
			skillFilePath: skillFile,
			source: "userSettings",
			baseDir: skillDir,
			loadedFrom: "skills",
			paths: undefined,
		});

		const tokens = estimateSkillFrontmatterTokens(cmd);
		// 5000-char body 不进估算: name+description 远小于 5000 字符
		expect(tokens).toBeLessThan(100);
	});

	it("markdownContent (inline/MCP) 路径仍 eager, 不走文件 read", async () => {
		const skillDir = join(dir, "inline-skill");
		// 不创建文件 — 传 markdownContent, 无 skillFilePath
		const { parsed } = buildSkill(
			join(skillDir, "SKILL.md"),
			"---\nname: Inline\n---\nInline body content\n",
		);

		const cmd = createSkillCommand({
			...parsed,
			skillName: "inline-skill",
			markdownContent: "Inline body content",
			source: "userSettings",
			baseDir: undefined,
			loadedFrom: "mcp",
			paths: undefined,
		});

		if (cmd.type !== "prompt") throw new Error("expected prompt command");
		// markdownContent 路径 contentLength = 串长度 (非 0)
		expect(cmd.contentLength).toBe("Inline body content".length);
		const r = await cmd.getPromptForCommand("", minimalContext);
		expect(blockText(r)).toContain("Inline body content");
	});
});
