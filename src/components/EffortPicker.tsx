import { useCallback } from "react";
import { Box, Text } from "../ink.js";
import {
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	logEvent,
} from "../services/analytics/index.js";
import type { OptionWithDescription } from "./CustomSelect/select.js";
import { Select } from "./CustomSelect/select.js";
import { Dialog } from "./design-system/Dialog.js";

// Effort levels shown by the /effort no-args picker. Mirrors the
// descriptions in src/commands/effort/effort.tsx help text so the
// selector and /effort help stay in sync.
const EFFORT_PICKER_OPTIONS: OptionWithDescription<string>[] = [
	{
		label: "low",
		value: "low",
		description: "Quick, straightforward implementation",
	},
	{
		label: "medium",
		value: "medium",
		description: "Balanced approach with standard testing",
	},
	{
		label: "high",
		value: "high",
		description: "Comprehensive implementation with extensive testing",
	},
	{
		label: "max",
		value: "max",
		description: "Maximum capability with deepest reasoning (Opus 4.6 only)",
	},
	{
		label: "auto",
		value: "auto",
		description: "Use the default effort level for your model",
	},
];

export type EffortPickerProps = {
	initialEffort: string;
	onComplete: (level: string) => void;
	onCancel: () => void;
	isStandaloneCommand?: boolean;
};

export function EffortPicker({
	initialEffort,
	onComplete,
	onCancel,
	isStandaloneCommand,
}: EffortPickerProps): React.ReactNode {
	const handleSelect = useCallback(
		(level: string) => {
			logEvent("tengu_effort_command", {
				effort:
					level as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			});
			onComplete(level);
		},
		[onComplete],
	);

	return (
		<Dialog
			title="Effort level"
			onCancel={onCancel}
			hideInputGuide={!isStandaloneCommand}
			hideBorder={!isStandaloneCommand}
		>
			<Box flexDirection="column" gap={1}>
				<Box marginTop={1}>
					<Text dimColor>Select an effort level for this session.</Text>
				</Box>
				<Select
					options={EFFORT_PICKER_OPTIONS}
					onChange={handleSelect}
					onCancel={onCancel}
					visibleOptionCount={5}
					defaultValue={initialEffort}
				/>
			</Box>
		</Dialog>
	);
}
