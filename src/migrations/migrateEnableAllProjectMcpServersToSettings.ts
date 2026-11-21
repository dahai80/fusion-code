import { logEvent } from "src/services/analytics/index.js";
import {
	getCurrentProjectConfig,
	saveCurrentProjectConfig,
} from "../utils/config.js";
import { logError } from "../utils/log.js";
import {
	getSettingsForSource,
	updateSettingsForSource,
} from "../utils/settings/settings.js";

/**
 * Migration: Move MCP server approval fields from project config to local settings
 * This migrates both enableAllProjectMcpServers and enabledMcpjsonServers to the
 * settings system for better management and consistency.
 */
export function migrateEnableAllProjectMcpServersToSettings(): void {
	const projectConfig = getCurrentProjectConfig();

	// Check if any field exists in project config
	const hasEnableAll = projectConfig.enableAllProjectMcpServers !== undefined;
	const hasEnabledServers =
		projectConfig.enabledMcpjsonServers &&
		projectConfig.enabledMcpjsonServers.length > 0;
	const hasDisabledServers =
		projectConfig.disabledMcpjsonServers &&
		projectConfig.disabledMcpjsonServers.length > 0;

	if (!hasEnableAll && !hasEnabledServers && !hasDisabledServers) {
		return;
	}

	try {
		const existingSettings = getSettingsForSource("localSettings") || {};
		const updates: Partial<{
			enableAllProjectMcpServers: boolean;
			enabledMcpjsonServers: string[];
			disabledMcpjsonServers: string[];
		}> = {};
		const fieldsToRemove: Array<
			| "enableAllProjectMcpServers"
			| "enabledMcpjsonServers"
			| "disabledMcpjsonServers"
		> = [];

		// Migrate enableAllProjectMcpServers if it exists and hasn't been migrated
		if (
			hasEnableAll &&
			existingSettings.enableAllProjectMcpServers === undefined
		) {
			updates.enableAllProjectMcpServers =
				projectConfig.enableAllProjectMcpServers;
			fieldsToRemove.push("enableAllProjectMcpServers");
		} else if (hasEnableAll) {
			// Already migrated, just mark for removal
			fieldsToRemove.push("enableAllProjectMcpServers");
		}

		// Migrate enabledMcpjsonServers if it exists
		if (hasEnabledServers && projectConfig.enabledMcpjsonServers) {
			const existingEnabledServers =
				existingSettings.enabledMcpjsonServers || [];
			// Merge the servers (avoiding duplicates)
			updates.enabledMcpjsonServers = [
				...new Set([
					...existingEnabledServers,
					...projectConfig.enabledMcpjsonServers,
				]),
			];
			fieldsToRemove.push("enabledMcpjsonServers");
		}

		// Migrate disabledMcpjsonServers if it exists
		if (hasDisabledServers && projectConfig.disabledMcpjsonServers) {
			const existingDisabledServers =
				existingSettings.disabledMcpjsonServers || [];
			// Merge the servers (avoiding duplicates)
			updates.disabledMcpjsonServers = [
				...new Set([
					...existingDisabledServers,
					...projectConfig.disabledMcpjsonServers,
				]),
			];
			fieldsToRemove.push("disabledMcpjsonServers");
		}

		// P2-14: write settings and confirm success first, then remove the project fields — prevents data loss on partial failure.
		// Before: updateSettingsForSource succeeded + saveCurrentProjectConfig threw → settings
		// carried the migrated values but project config still had the old fields; the reverse
		// (settings write failed + project field removal succeeded) → data lost. The old try/catch
		// swallowed exceptions → reruns could not detect the partial state. Now:
		// (1) the settings write must be error-free before removing project fields; (2) only remove
		// successfully migrated fields (migratedFields), leaving unmigrated ones for the next rerun;
		// (3) any failure logs loudly instead of staying silent.
		const migratedFields: typeof fieldsToRemove = [];

		// Update settings if there are any updates
		if (Object.keys(updates).length > 0) {
			const result = updateSettingsForSource("localSettings", updates);
			if (result?.error) {
				// settings write failed — do not remove project fields; keep source data for a rerun, log loudly
				logError(result.error);
				logEvent("fusion_migrate_mcp_approval_fields_error", {});
				return;
			}
			// settings write succeeded — mark all fields pushed this round as migrated
			migratedFields.push(...fieldsToRemove);
		} else if (fieldsToRemove.length > 0) {
			// No updates but fieldsToRemove non-empty = fields already migrated (else branch), only pending removal
			migratedFields.push(...fieldsToRemove);
		}

		// Only after settings holds the data, remove the migrated fields from project config
		if (migratedFields.length > 0) {
			const _removeSet = new Set(migratedFields);
			saveCurrentProjectConfig((current) => {
				// Preserve the ProjectConfig type: selectively destructure fields out by name
				const {
					enableAllProjectMcpServers: _e,
					enabledMcpjsonServers: _en,
					disabledMcpjsonServers: _d,
					...rest
				} = current;
				return rest;
			});
		}

		// Log the migration event
		logEvent("fusion_migrate_mcp_approval_fields_success", {
			migratedCount: fieldsToRemove.length,
		});
	} catch (e: unknown) {
		// Log migration failure but don't throw to avoid breaking startup
		logError(e);
		logEvent("fusion_migrate_mcp_approval_fields_error", {});
	}
}
