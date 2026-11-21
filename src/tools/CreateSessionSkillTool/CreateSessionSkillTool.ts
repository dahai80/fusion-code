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
	// Runtime gate (preset visibility): FUSION_CODE_SESSION_SKILLS_ENABLED=1 required to enter the preset list.
	// The compile-time gate feature("SESSION_SKILLS") cannot go here (Bun's feature() macro can only be used
	// directly in if/ternary, cannot be wrapped in Boolean() or inside a function), so it lives in the if statement inside execute().
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
		// Double gate: feature("SESSION_SKILLS") (compile time, build:dev:full) AND
		// FUSION_CODE_SESSION_SKILLS_ENABLED=1 (runtime). Injection only when both are satisfied;
		// otherwise byte-identical validation stub (feature off → dead-code eliminates the whole if body).
		// The feature() macro must be used directly in the if condition (Bun limitation), cannot be wrapped in Boolean()/lifted into a function.
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

			// P3-13: allowedTools injects alwaysAllowRules.command = executing this skill skips permission prompts
			// (auto-allow). A model-created skill could declare arbitrary strings to widen the auto-allow scope (silent privilege escalation). Validation:
			// 1. Extract the base name (strip the parenthesized part of `Name(glob)` + trim whitespace);
			// 2. The base name must match a known builtin tool, or be an MCP tool prefix mcp__ (external dynamic tools);
			// 3. The base name must not be in FUSION.rules denied_tools (denied_tools is enforced again at execution time, but
			//    the prompt-free authorization here would already conflict with deny — reject at creation time, fail-visible instead of silently bypassing).
			// Dynamic import of tools.ts avoids a compile-time cycle (tools.ts imports this tool in reverse to inject presets).
			if (allowedTools && allowedTools.length > 0) {
				const { getAllBaseTools } = await import("../../tools.js");
				const knownNames = new Set(
					getAllBaseTools().flatMap((t) => [t.name, ...(t.aliases ?? [])]),
				);
				const invalid: string[] = [];
				for (const raw of allowedTools) {
					const entry = raw.trim();
					if (!entry) continue;
					// `Name(glob)` → take the base name before `(`; without parens the whole string is the name.
					const baseName = entry.includes("(")
						? entry.slice(0, entry.indexOf("(")).trim()
						: entry;
					if (!baseName) {
						invalid.push(entry);
						continue;
					}
					if (baseName.startsWith("mcp__")) {
						// MCP tools are dynamically registered and not in knownNames — only check denied_tools.
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

			// Build the in-memory Command (markdownContent inline, no skillFilePath → eager body).
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
				// source "bundled" = in-memory non-file origin (closest semantics; not the real bundled registry).
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
			// getDynamicSkills() returns a fresh array on every getCommands call (not memoized), so new skills
			// are visible on the next getCommands call with no emit/cache-clear needed.
			logSessionSkillRegister(name, body.length, replaced);

			// Metadata-only audit (markdown body not recorded — sensitive/voluminous); target is the skill name.
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
				// Audit failure does not block registration (fail-open bookkeeping; the skill is already active).
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
		// Double-gate-not-met stub: feature off or env off → no registration, return not-enabled.
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
