import type { AutoUpdaterResult } from "../utils/autoUpdater.js";

// Update notifications removed with the auto-updater: fusion-code has no
// self-update channel. Kept as a null component so the Notifications prop
// plumbing (REPL → PromptInput → Notifications) stays compiling; renders nothing.

type Props = {
	verbose: boolean;
	onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
	autoUpdaterResult: AutoUpdaterResult | null;
	isUpdating: boolean;
	onChangeIsUpdating: (isUpdating: boolean) => void;
	showSuccessMessage: boolean;
};

export function AutoUpdaterWrapper(_props: Props): null {
	return null;
}
