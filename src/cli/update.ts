import { gracefulShutdown } from "src/utils/gracefulShutdown.js";
import { writeToStdout } from "src/utils/process.js";

// Fusion-Code has no auto-update channel: the binary is built from source
// (bun run build / bun run compile) and released as git tags. The upstream
// installer machinery (npm registry, Anthropic GCS bucket, native installer)
// was removed — `update` must never download another product over this fork.

export async function update(): Promise<void> {
	writeToStdout(`Fusion-Code ${MACRO.VERSION}\n`);
	writeToStdout(
		"fusion-code does not self-update. To update:\n" +
			"  git pull\n" +
			"  bun install\n" +
			"  bun run build\n",
	);
	await gracefulShutdown(0);
}
