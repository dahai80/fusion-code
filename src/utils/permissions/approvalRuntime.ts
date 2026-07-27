import { logEvent } from "../../services/analytics/index.js";
import type {
	PermissionBehavior,
	PermissionRuleValue,
} from "../../types/permissions.js";
import type { EditableSettingSource } from "../settings/constants.js";
import {
	getSettingsForSource,
	updateSettingsForSource,
} from "../settings/settings.js";
import {
	permissionRuleValueFromString,
	permissionRuleValueToString,
} from "./permissionRuleParser.js";
import { addPermissionRulesToSettings } from "./permissionsLoader.js";

const SESSION_SOURCE = "session" as unknown as EditableSettingSource; // log: cast session to EditableSettingSource

const BEHAVIORS: PermissionBehavior[] = ["allow", "deny"];

export function cancelBySource(source: EditableSettingSource): boolean {
	try {
		const settingsData = getSettingsForSource(source);
		if (!settingsData?.permissions) {
			return true;
		}
		const hadRules = BEHAVIORS.some(
			(b) => (settingsData.permissions?.[b]?.length ?? 0) > 0,
		);
		if (!hadRules) {
			return true;
		}
		const cleaned = { ...settingsData, permissions: {} };
		updateSettingsForSource(source, cleaned);
		logEvent("tengu_permission_cancel_by_source", {
			source: source as unknown as number | boolean,
		} as Record<string, number | boolean | undefined>); // log: cast for LogEventMetadata
		return true;
	} catch (error) {
		console.error(`[approvalRuntime] cancelBySource failed: ${error}`);
		return false;
	}
}

export function cancelSessionRules(): boolean {
	return cancelBySource(SESSION_SOURCE);
}

export function approveForSession(
	toolName: string,
	ruleContent?: string,
): boolean {
	try {
		const ruleValue: PermissionRuleValue = {
			toolName,
			...(ruleContent ? { ruleContent } : {}),
		};
		const success = addPermissionRulesToSettings(
			{
				ruleValues: [ruleValue],
				ruleBehavior: "allow",
			},
			SESSION_SOURCE,
		);
		if (success) {
			logEvent("tengu_permission_approve_for_session", {
				tool_name: toolName as unknown as number | boolean,
				rule_content: (ruleContent ?? "") as unknown as number | boolean,
			} as Record<string, number | boolean | undefined>); // log: cast for LogEventMetadata
		}
		return success;
	} catch (error) {
		console.error(`[approvalRuntime] approveForSession failed: ${error}`);
		return false;
	}
}

export function denyForSession(
	toolName: string,
	ruleContent?: string,
): boolean {
	try {
		const ruleValue: PermissionRuleValue = {
			toolName,
			...(ruleContent ? { ruleContent } : {}),
		};
		const success = addPermissionRulesToSettings(
			{
				ruleValues: [ruleValue],
				ruleBehavior: "deny",
			},
			SESSION_SOURCE,
		);
		if (success) {
			logEvent("tengu_permission_deny_for_session", {
				tool_name: toolName as unknown as number | boolean,
				rule_content: (ruleContent ?? "") as unknown as number | boolean,
			} as Record<string, number | boolean | undefined>); // log: cast for LogEventMetadata
		}
		return success;
	} catch (error) {
		console.error(`[approvalRuntime] denyForSession failed: ${error}`);
		return false;
	}
}

export function getSessionApprovedTools(): string[] {
	try {
		const settingsData = getSettingsForSource(SESSION_SOURCE);
		const allowRules = settingsData?.permissions?.allow ?? [];
		return allowRules.map((raw: string) => {
			const parsed = permissionRuleValueFromString(raw);
			return permissionRuleValueToString(parsed);
		});
	} catch {
		return [];
	}
}
