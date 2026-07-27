import chalk from "chalk";
import type { Command, LocalCommandCall } from "../../types/command.js";
import { logForDebugging } from "../../utils/debug.js";
import {
	addPermissionRulesToSettings,
	loadAllPermissionRulesFromDisk,
} from "../../utils/permissions/permissionsLoader.js";

const call: LocalCommandCall = async (args, context) => {
	try {
		const rules = loadAllPermissionRulesFromDisk();
		const allowRules = rules.filter((r) => r.rule === "allow");

		const readOnlyTools = ["Read", "Glob", "Grep", "TaskList", "TaskGet"];
		const alreadyAllowed = new Set(
			allowRules
				.filter((r) => readOnlyTools.includes(r.tool))
				.map((r) => r.tool),
		);
		const missingReadOnly = readOnlyTools.filter((t) => !alreadyAllowed.has(t));

		if (missingReadOnly.length === 0) {
			return {
				type: "text",
				value: chalk.green(
					"All read-only tools already have allow rules. No suggestions needed.",
				),
			};
		}

		if (args.trim() === "--apply") {
			const newRules = missingReadOnly.map((tool) => ({
				toolName: tool, // log: fixed property name for PermissionRuleValue
			}));
			addPermissionRulesToSettings(
				{ ruleValues: newRules, ruleBehavior: "allow" },
				"userSettings",
			); // log: fixed arg shape for addPermissionRulesToSettings
			logForDebugging(
				`[less-permission] Added ${newRules.length} allow rules for read-only tools`,
			);
			return {
				type: "text",
				value: chalk.green(
					`Added allow rules for: ${missingReadOnly.join(", ")}\nYou will no longer be prompted for these read-only operations.`,
				),
			};
		}

		const lines = [
			chalk.bold("Suggested allow rules for read-only tools:"),
			"",
			...missingReadOnly.map(
				(t) => `  ${chalk.cyan(t)} — currently prompts for permission`,
			),
			"",
			`Run ${chalk.yellow("/less-permission-prompts --apply")} to add these allow rules.`,
			"",
			chalk.dim(
				"Current allow rules: " +
					(allowRules.length === 0
						? "none"
						: allowRules.map((r) => `${r.tool}(${r.rule})`).join(", ")),
			),
		];
		logForDebugging(
			`[less-permission] Suggested ${missingReadOnly.length} read-only allow rules`,
		);
		return { type: "text", value: lines.join("\n") };
	} catch (err) {
		logForDebugging(`[less-permission] Error: ${(err as Error).message}`);
		return { type: "text", value: `Failed: ${(err as Error).message}` };
	}
};

const lessPermissionPrompts = {
	type: "local",
	name: "less-permission-prompts",
	description:
		"Suggest allow rules for read-only tools to reduce permission prompts",
	isEnabled: () => true,
	isHidden: false,
	supportsNonInteractive: true,
	load: () => Promise.resolve({ call }),
} satisfies Command;

export default lessPermissionPrompts;
