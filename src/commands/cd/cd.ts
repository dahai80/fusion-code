import { homedir } from "os";
import { basename, isAbsolute, resolve } from "path";
import { logEvent } from "../../services/analytics/index.js";
import type { LocalCommandModule } from "../../types/command.js";
import { getCwd } from "../../utils/cwd.js";
import { setCwd } from "../../utils/Shell.js";

async function listDirSuggestions(dir: string): Promise<string[]> {
	const fs = await import("fs/promises");
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

export const call: LocalCommandModule["call"] = async (args) => {
	const trimmed = args.trim();

	if (!trimmed || trimmed === "~") {
		const home = homedir();
		setCwd(home);
		process.chdir(home);
		logEvent("tengu_cd", { target: 1 }); // log: analytics metadata must be number|boolean
		return { type: "text", value: `Changed directory to ${home}` };
	}

	const target = trimmed.startsWith("~")
		? resolve(homedir(), trimmed.slice(1))
		: isAbsolute(trimmed)
			? trimmed
			: resolve(getCwd(), trimmed);

	try {
		setCwd(target);
		process.chdir(target);
		logEvent("tengu_cd", { target: 1 }); // log: analytics metadata must be number|boolean

		const suggestions = await listDirSuggestions(target);
		const dirName = basename(target);
		const hint =
			suggestions.length > 0
				? ` (subdirs: ${suggestions.slice(0, 8).join(", ")}${suggestions.length > 8 ? " ..." : ""})`
				: "";
		return { type: "text", value: `Changed directory to ${dirName}${hint}` };
	} catch (err: any) {
		const msg = err?.message ?? String(err);
		return { type: "text", value: `cd: ${msg}` };
	}
};
