// P5.5 能力清单 (Typert 类型图) — CLI 处理器 (enhance-0819.md §D.7 P5.5)。
//
// 子命令:
//   fusion-code capability export [--no-schemas] [--no-skills] [--no-plugins] [--indent N]
//   fusion-code capability [--help]
//
// 从 fusion-code 工具/技能/插件定义生成类型图 (JSON 清单)。
// 默认 off: feature("CAPABILITY_MANIFEST") 编译期 + FUSION_CODE_CAPABILITY_MANIFEST_ENABLED=1 运行期。
// 评估而非照搬: RPC 网关远程控制面 defer (安全面)。

import { getOriginalCwd } from "../../bootstrap/state.js";
import { exportCapabilityManifest } from "../../services/capability/index.js";
import { isCapabilityManifestEnabled } from "../../services/capability/index.js";

interface ParsedFlags {
	noSchemas: boolean;
	noSkills: boolean;
	noPlugins: boolean;
	indent: number;
	positional: string[];
}

function parseFlags(args: string[]): ParsedFlags {
	const out: ParsedFlags = {
		noSchemas: false,
		noSkills: false,
		noPlugins: false,
		indent: 2,
		positional: [],
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--no-schemas") out.noSchemas = true;
		else if (a === "--no-skills") out.noSkills = true;
		else if (a === "--no-plugins") out.noPlugins = true;
		else if (a === "--indent") {
			const n = Number(args[++i]);
			if (Number.isFinite(n) && n >= 0) out.indent = n;
		} else if (a === "--help" || a === "-h") out.positional.push("help");
		else if (a) out.positional.push(a);
	}
	return out;
}

function usage(): void {
	console.log("Usage:");
	console.log(
		"  fusion-code capability export [--no-schemas] [--no-skills] [--no-plugins] [--indent N]",
	);
	console.log("");
	console.log("Generate a capability manifest (type graph) from fusion-code");
	console.log("tools, skills, and plugin definitions. Output is JSON to stdout.");
	console.log("");
	console.log("Options:");
	console.log("  --no-schemas    Omit tool input JSON schemas (name graph only).");
	console.log("  --no-skills     Omit skill/command entries.");
	console.log("  --no-plugins    Omit plugin entries.");
	console.log("  --indent N      JSON indent width (default 2).");
	console.log("");
	console.log("Requires FUSION_CODE_CAPABILITY_MANIFEST_ENABLED=1 and a build with");
	console.log("the CAPABILITY_MANIFEST feature flag.");
}

export async function capabilityMain(args: string[]): Promise<void> {
	const sub = args[0]?.toLowerCase();
	const flags = parseFlags(args.slice(1));

	if (sub === "--help" || sub === "-h" || flags.positional.includes("help")) {
		usage();
		return;
	}

	if (!isCapabilityManifestEnabled()) {
		console.error(
			"capability manifest is not enabled. Set FUSION_CODE_CAPABILITY_MANIFEST_ENABLED=1",
			"and build with the CAPABILITY_MANIFEST feature flag.",
		);
		return;
	}

	if (sub !== "export") {
		usage();
		return;
	}

	const cwd = getOriginalCwd();
	const manifest = await exportCapabilityManifest({
		cwd,
		generatedAt: new Date().toISOString(),
		includeSkills: !flags.noSkills,
		includePlugins: !flags.noPlugins,
		includeSchemas: !flags.noSchemas,
	});

	console.log(JSON.stringify(manifest, null, flags.indent));
}
