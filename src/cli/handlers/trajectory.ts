// D1 轨迹飞轮 — CLI 处理器 (issue #50/#51)
//
// 子命令:
//   fusion-code trajectory collect [--source DIR] [--dest DIR] [--product NAME]
//   fusion-code trajectory export  --format sft|dpo|grpo [--source DIR] [--dest DIR] [--session ID]
//   fusion-code trajectory manifest [--dest DIR]
//   fusion-code trajectory list    [--source DIR]
//
// 默认 source = ~/.fusion-code/projects, dest = ~/.fusion/trajectories

import {
	collectTrajectories,
	exportTrajectories,
	readManifest,
	DEFAULT_DEST_DIR,
	DEFAULT_SOURCE_DIR,
} from "../../services/trajectory/index.js";

interface ParsedFlags {
	source: string;
	dest: string;
	product: string;
	format: string;
	session: string;
	positional: string[];
}

function parseFlags(args: string[]): ParsedFlags {
	const out: ParsedFlags = {
		source: DEFAULT_SOURCE_DIR,
		dest: DEFAULT_DEST_DIR,
		product: "fusion-code",
		format: "",
		session: "",
		positional: [],
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--source") out.source = args[++i] ?? "";
		else if (a === "--dest") out.dest = args[++i] ?? "";
		else if (a === "--product") out.product = args[++i] ?? "";
		else if (a === "--format") out.format = args[++i] ?? "";
		else if (a === "--session") out.session = args[++i] ?? "";
		else if (a) out.positional.push(a);
	}
	return out;
}

function usage(): void {
	console.log("Usage:");
	console.log(
		"  fusion-code trajectory collect [--source DIR] [--dest DIR] [--product NAME]",
	);
	console.log(
		"  fusion-code trajectory export  --format sft|dpo|grpo [--dest DIR] [--session ID]",
	);
	console.log("  fusion-code trajectory manifest [--dest DIR]");
	console.log("  fusion-code trajectory list [--source DIR]");
}

export async function trajectoryMain(args: string[]): Promise<void> {
	const sub = args[0]?.toLowerCase();
	const flags = parseFlags(args.slice(1));

	if (sub === "collect") {
		const manifest = await collectTrajectories({
			sourceDir: flags.source,
			destDir: flags.dest,
			product: flags.product,
		});
		console.log(
			"collected " +
				manifest.totals.sessions +
				" sessions, " +
				manifest.totals.positive +
				" positive / " +
				manifest.totals.selfCorrection +
				" self_correction → " +
				flags.dest,
		);
		return;
	}

	if (sub === "export") {
		if (!flags.format) {
			console.error("Error: --format sft|dpo|grpo is required");
			usage();
			process.exitCode = 1;
			return;
		}
		if (
			flags.format !== "sft" &&
			flags.format !== "dpo" &&
			flags.format !== "grpo"
		) {
			console.error(
				"Error: format must be one of sft|dpo|grpo, got " + flags.format,
			);
			process.exitCode = 1;
			return;
		}
		// export 的输入是汇聚库 (collect 的 --dest), 输出 sft/dpo/grpo.jsonl 也写入该库
		const result = await exportTrajectories({
			sourceDir: flags.dest,
			destDir: flags.dest,
			format: flags.format,
			sessionId: flags.session || undefined,
		});
		console.log(
			"exported " +
				result.count +
				" " +
				result.format +
				" samples → " +
				result.destFile,
		);
		return;
	}

	if (sub === "manifest") {
		const manifest = await readManifest(flags.dest);
		if (!manifest) {
			console.log("No manifest at " + flags.dest + ". Run `collect` first.");
			return;
		}
		console.log(JSON.stringify(manifest.totals, null, 2));
		for (const s of manifest.sessions) {
			console.log(
				"  " +
					s.sessionId +
					"  label=" +
					s.label +
					"  steps=" +
					s.stepCount +
					"  tools=" +
					s.toolUseCount +
					"  errors=" +
					s.toolErrorCount,
			);
		}
		return;
	}

	if (sub === "list") {
		const manifest = await readManifest(flags.dest);
		if (!manifest) {
			console.log("No manifest at " + flags.dest + ". Run `collect` first.");
			return;
		}
		for (const s of manifest.sessions) {
			console.log(s.sessionId + "  " + s.label + "  " + s.stepCount + " steps");
		}
		return;
	}

	usage();
}
