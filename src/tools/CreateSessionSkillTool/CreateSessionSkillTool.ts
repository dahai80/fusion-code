import { feature } from "bun:bundle";
import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import {
	createSkillCommand,
	registerDynamicSkill,
} from "../../skills/loadSkillsDir.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { logForDebugging } from "../../utils/debug.js";
import { isToolDenied } from "../../utils/fusionRules.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { CREATE_SESSION_SKILL_TOOL_NAME } from "./constants.js";
import {
	isSessionSkillsEnabled,
	isValidSessionSkillName,
	logSessionSkillRegister,
	MAX_SESSION_SKILL_BODY,
} from "./runtime.js";

const DESCRIPTION =
	"Create a one-off, session-scoped skill from a markdown body. The skill lives in memory only — it is not written to disk, does not persist across sessions, and is dropped on /clear. Use for reusable procedures you want the model to invoke via /<name> within this session. The vm is not a security boundary: the skill body is still subject to existing tool-permission and hook checks when executed.";

const inputSchema = lazySchema(() =>
	z.strictObject({
		name: z
			.string()
			.describe(
				"Skill name, lowercase kebab-case (e.g. 'my-proc'). Used as /<name> to invoke.",
			),
		description: z
			.string()
			.max(500)
			.describe("One-line description shown in the skill list."),
		body: z
			.string()
			.max(MAX_SESSION_SKILL_BODY)
			.describe(
				"Markdown skill body (the instructions the model follows when the skill is invoked).",
			),
		whenToUse: z
			.string()
			.optional()
			.describe("Hint for when the model should auto-invoke this skill."),
		allowedTools: z
			.array(z.string())
			.optional()
			.describe(
				"Tools this skill may use. Omit for all tools (default skill behavior).",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		name: z.string().describe("The registered skill name"),
		registered: z
			.boolean()
			.describe("Whether the skill was registered successfully"),
		replaced: z
			.boolean()
			.optional()
			.describe(
				"Whether an existing in-memory skill of the same name was overwritten",
			),
		error: z
			.string()
			.optional()
			.describe("Error message if registration failed"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type Output = z.infer<OutputSchema>;

export const CreateSessionSkillTool = buildTool({
	name: CREATE_SESSION_SKILL_TOOL_NAME,
	searchHint: "create a one-off session-scoped skill in memory",
	maxResultSizeChars: 10_000,
	async description() {
		return DESCRIPTION;
	},
	async prompt() {
		return DESCRIPTION;
	},
	// 运行期门禁 (preset 可见性): FUSION_CODE_SESSION_SKILLS_ENABLED=1 才进 preset 列表。
	// 编译期门禁 feature("SESSION_SKILLS") 不能放此 (Bun feature() 宏只能直接用于
	// if/ternary, 不能包 Boolean() 或函数内), 故放 execute() 内 if 语句。
	isEnabled() {
		return isSessionSkillsEnabled();
	},
	isReadOnly() {
		return false;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async execute(
		{ name, description, body, whenToUse, allowedTools },
		_context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
		// 双门禁: feature("SESSION_SKILLS") (编译期, build:dev:full) AND
		// FUSION_CODE_SESSION_SKILLS_ENABLED=1 (运行期)。两层都满足才注入;
		// 否则 byte-identical 验证桩 (feature off → dead-code 消除整个 if 体)。
		// feature() 宏必须直接用于 if 条件 (Bun 限制), 不能包 Boolean()/提入函数。
		if (feature("SESSION_SKILLS") && isSessionSkillsEnabled()) {
			if (!isValidSessionSkillName(name)) {
				return {
					data: {
						name,
						registered: false,
						error: `Invalid skill name "${name}": must be lowercase kebab-case (a-z0-9 and hyphens), max 64 chars, start with alphanumeric.`,
					},
				};
			}
			if (!description.trim()) {
				return {
					data: {
						name,
						registered: false,
						error: "Skill description must not be empty.",
					},
				};
			}
			if (!body.trim()) {
				return {
					data: {
						name,
						registered: false,
						error: "Skill body must not be empty.",
					},
				};
			}

			// P3-13: allowedTools 注入 alwaysAllowRules.command = 该 skill 执行时免权限提示
			// 自动允许。模型自建 skill 可声明任意字符串扩免提示范围 (静默提权)。校验:
			// 1. 提取 base 名 (剥 `Name(glob)` 的括号部分 + 去空白);
			// 2. base 名须命中已知内置工具, 或为 MCP 工具前缀 mcp__ (外部动态工具);
			// 3. base 名不能在 FUSION.rules denied_tools (denied_tools 执行期再拦, 但
			//    此处免提示授权已与 deny 冲突 — 创建期即拒, fail-visible 不静默绕过)。
			// 动态 import tools.ts 避编译期循环 (tools.ts 反向 import 本工具注入 preset)。
			if (allowedTools && allowedTools.length > 0) {
				const { getAllBaseTools } = await import("../../tools.js");
				const knownNames = new Set(
					getAllBaseTools().flatMap((t) => [
						t.name,
						...(t.aliases ?? []),
					]),
				);
				const invalid: string[] = [];
				for (const raw of allowedTools) {
					const entry = raw.trim();
					if (!entry) continue;
					// `Name(glob)` → 取 `(` 前的 base 名; 无括号则整串为名。
					const baseName =
						entry.includes("(")
							? entry.slice(0, entry.indexOf("(")).trim()
							: entry;
					if (!baseName) {
						invalid.push(entry);
						continue;
					}
					if (baseName.startsWith("mcp__")) {
						// MCP 工具动态注册, 不在 knownNames — 仅查 denied_tools。
						if (isToolDenied(baseName)) {
							invalid.push(entry);
						}
						continue;
					}
					if (!knownNames.has(baseName) || isToolDenied(baseName)) {
						invalid.push(entry);
					}
				}
				if (invalid.length > 0) {
					logForDebugging(
						`session-skill "${name}" rejected allowedTools (unknown/denied): ${invalid.join(", ")}`,
					);
					return {
						data: {
							name,
							registered: false,
							error: `allowedTools contains unknown or denied tool(s): ${invalid.join(
								", ",
							)}. Only known built-in tools (or mcp__ tools not denied by FUSION.rules) may be claimed. Remove them or pick valid tool names.`,
						},
					};
				}
			}

			// 构造 in-memory Command (markdownContent inline, 无 skillFilePath → eager 正文)。
			const skill = createSkillCommand({
				skillName: name,
				displayName: name,
				description,
				hasUserSpecifiedDescription: true,
				markdownContent: body,
				allowedTools: allowedTools ?? [],
				disallowedTools: [],
				argumentHint: undefined,
				argumentNames: [],
				whenToUse,
				version: undefined,
				model: undefined,
				disableModelInvocation: false,
				userInvocable: true,
				// source "bundled" = in-memory 非文件来源 (语义最近; 非真实 bundled 注册表)。
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

			const replaced = registerDynamicSkill(skill);
			// getDynamicSkills() 每次 getCommands 调用都返回新数组 (非 memoize), 新技能
			// 在下一次 getCommands 调用立即可见, 无需 emit/清缓存。
			logSessionSkillRegister(name, body.length, replaced);

			// 仅元数据审计 (不记 markdown 正文 — 敏感/体积); target 技能名。
			try {
				const { appendAuditLog, createAuditEntry } = await import(
					"../../services/audit/index.js"
				);
				await appendAuditLog(
					createAuditEntry(
						String(getSessionId()),
						CREATE_SESSION_SKILL_TOOL_NAME,
						"skill_write",
						name,
						{
							success: true,
							detail: `whenToUse=${whenToUse ? "set" : "none"} bodyLen=${body.length}${replaced ? " replaced" : ""}`,
						},
					),
				);
			} catch (auditErr) {
				// 审计失败不阻塞注册 (fail-open 记账, 技能已生效)。
				logForDebugging(
					`[SessionSkill] audit log failed for "${name}": ${(auditErr as Error).message}`,
				);
			}

			return {
				data: {
					name,
					registered: true,
					replaced,
				},
			};
		}
		// 双门禁未满足桩: feature off 或 env off → 不注册, 返回未启用。
		return {
			data: {
				name,
				registered: false,
				error:
					"Session skills are not enabled (set FUSION_CODE_SESSION_SKILLS_ENABLED=1 and build with SESSION_SKILLS).",
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { name, registered, replaced, error } = content as Output;
		if (!registered) {
			return {
				tool_use_id: toolUseID,
				type: "tool_result",
				content: `Session skill "${name}" not created: ${error}`,
				is_error: true,
			};
		}
		const note = replaced ? " (replaced existing in-memory skill)" : "";
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Session skill "/${name}" created in memory${note}. It is not persisted and will be dropped on /clear or session end. Invoke via /${name}.`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
