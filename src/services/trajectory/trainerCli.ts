// D1 轨迹飞轮 — fusion-trainer 子进程封装 (issue #61)
//
// 把 export 产出的 SFT/DPO/GRPO .jsonl 喂给同仓 .venv 的 fusion-trainer CLI。
// format → method 映射:
//   sft  → fusion-trainer sft  --dataset <file>
//   dpo  → fusion-trainer rlsl --method dpo  --dataset <file>
//   grpo → fusion-trainer rlsl --method grpo --dataset <file>

import { execa } from "execa";

export type TrainerFormat = "sft" | "dpo" | "grpo";

export interface TrainerCliOptions {
	format: TrainerFormat;
	dataset: string;
	model?: string;
	config?: string;
	outputDir?: string;
	venvBin?: string;
}

export interface TrainerCliResult {
	exitCode: number;
	command: string;
	args: string[];
}

const DEFAULT_VENV_BIN = "/Users/dahai/fusion/.venv/bin/fusion-trainer";

function log(msg: string): void {
	console.error("[trajectory:train] " + msg);
}

function buildArgs(opts: TrainerCliOptions): { sub: string; args: string[] } {
	const args: string[] = [];
	let sub: string;
	if (opts.format === "sft") {
		sub = "sft";
	} else {
		sub = "rlsl";
		args.push("--method", opts.format);
	}
	args.push("--dataset", opts.dataset);
	if (opts.model) args.push("--model", opts.model);
	if (opts.config) args.push("--config", opts.config);
	if (opts.outputDir) args.push("--output-dir", opts.outputDir);
	return { sub, args };
}

export async function runTrainerCli(
	opts: TrainerCliOptions,
): Promise<TrainerCliResult> {
	const bin = opts.venvBin ?? DEFAULT_VENV_BIN;
	const { sub, args } = buildArgs(opts);
	const full = [sub, ...args];
	log("spawn " + bin + " " + full.join(" "));
	try {
		const result = await execa(bin, full, {
			stdio: "inherit",
			reject: false,
			env: { ...process.env },
		});
		log("exitCode=" + String(result.exitCode));
		return { exitCode: result.exitCode, command: bin, args: full };
	} catch (err) {
		log("spawn failed: " + String(err));
		return { exitCode: 1, command: bin, args: full };
	}
}
