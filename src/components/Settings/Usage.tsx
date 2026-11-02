import { Box, Text } from "../../ink.js";

// The /usage settings screen showed claude.ai subscription utilization
// (fetched from the cloud usage API — src/services/api/usage.ts
// fetchUtilization, now removed with the cloud account stack). Stub keeps
// the Settings tab rendering with an explanatory note.

export function Usage(): React.ReactNode {
	return (
		<Box flexDirection="column" paddingX={1}>
			<Text dimColor>
				Usage tracking is a claude.ai subscription feature and is not available.
				fusion-code connects directly to an Anthropic-compatible endpoint via
				FUSION_BASE_URL + FUSION_CLIENT_KEY.
			</Text>
		</Box>
	);
}
