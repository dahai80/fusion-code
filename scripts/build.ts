import { chmodSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const pkg = (await Bun.file(
	new URL("../package.json", import.meta.url),
).json()) as {
	name: string;
	version: string;
};

const args = process.argv.slice(2);
const compile = args.includes("--compile");
const dev = args.includes("--dev");

// P1-30: fullExperimentalFeatures — regenerated from the 90 unique feature('X')
// call sites in src/. `--feature-set=dev-full` now flips ALL flags the bundle
// references, so dead-code-eliminated experimental paths actually compile in.
// Keep this list in sync: re-run `grep -rhoE "feature\(\"[A-Z_]+\"\)" src/ | sort -u`
// when adding new feature() gates. Sorted alphabetically for stable diffs.
// P1-4 (audit R10): kept in sync by scripts/check-feature-flags.ts (CI gate).
const fullExperimentalFeatures = [
	"ABLATION_BASELINE",
	"AGENT_MEMORY_SNAPSHOT",
	"AGENT_TRIGGERS",
	"AGENT_TRIGGERS_REMOTE",
	"ALLOW_TEST_VERSIONS",
	"ANTI_DISTILLATION_CC",
	"AUTO_THEME",
	"AWAY_SUMMARY",
	"BASH_CLASSIFIER",
	"BG_SESSIONS",
	"BREAK_CACHE_COMMAND",
	// BRIDGE_MODE dropped: remote-control subsystem (bridgeMain.ts) removed at
	// 0.2.0 release (784815b); 19 feature("BRIDGE_MODE") gates wrap the dead
	// import at cli.tsx:239 / main.tsx:5652. Force-enabling it in dev-full made
	// the import non-DCE'd → unresolved → build:dev:full broken. Keep it off
	// everywhere (already off by default) so dev-full compiles. If remote-
	// control is reintroduced, restore the flag AND the bridgeMain module.
	"BUDDY",
	"BUILTIN_EXPLORE_PLAN_AGENTS",
	"BYOC_ENVIRONMENT_RUNNER",
	"CACHED_MICROCOMPACT",
	"CAPABILITY_MANIFEST",
	"CCR_AUTO_CONNECT",
	"CCR_MIRROR",
	"CHICAGO_MCP",
	"COMMIT_ATTRIBUTION",
	"COMPACTION_REMINDERS",
	"CONNECTOR_TEXT",
	"CONTEXT_COLLAPSE",
	"COORDINATOR_MODE",
	"COWORKER_TYPE_TELEMETRY",
	"DIRECT_CONNECT",
	"DOWNLOAD_USER_SETTINGS",
	"DUMP_CONFIG",
	"DUMP_SYSTEM_PROMPT",
	"EXPERIMENTAL_SKILL_SEARCH",
	"EXTRACT_MEMORIES",
	"FILE_PERSISTENCE",
	"FORK_SUBAGENT",
	"HARD_FAIL",
	"HISTORY_PICKER",
	"HISTORY_SNIP",
	"HOOK_PROMPTS",
	"IS_LIBC_GLIBC",
	"IS_LIBC_MUSL",
	"KAIROS",
	"KAIROS_BRIEF",
	"KAIROS_CHANNELS",
	"KAIROS_GITHUB_WEBHOOKS",
	"KAIROS_PUSH_NOTIFICATION",
	"LLM_ADAPTER_SEAM",
	"LODESTONE",
	"MCP_RICH_OUTPUT",
	"MCP_SKILLS",
	"MEMORY_SHAPE_TELEMETRY",
	"MESSAGE_ACTIONS",
	"MONITOR_TOOL",
	"NATIVE_CLIPBOARD_IMAGE",
	"NEW_INIT",
	"OVERFLOW_TEST_TOOL",
	"PERFETTO_TRACING",
	"POWERSHELL_AUTO_MODE",
	"PROACTIVE",
	"PROMPT_CACHE_BREAK_DETECTION",
	"QUICK_SEARCH",
	"REACTIVE_COMPACT",
	"REVIEW_ARTIFACT",
	"RUN_SKILL_GENERATOR",
	"SELF_HOSTED_RUNNER",
	"SESSION_SKILLS",
	"SHOT_STATS",
	"SKILL_IMPROVEMENT",
	"SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED",
	"SLOW_OPERATION_LOGGING",
	"SSH_REMOTE",
	"STREAMLINED_OUTPUT",
	"TEAMMEM",
	"TEMPLATES",
	"TELEMETRY",
	"TERMINAL_PANEL",
	"TOKEN_BUDGET",
	"TRANSCRIPT_CLASSIFIER",
	"TREE_SITTER_BASH",
	"TREE_SITTER_BASH_SHADOW",
	"UDS_INBOX",
	"ULTRAPLAN",
	"ULTRATHINK",
	"UNATTENDED_RETRY",
	"UPLOAD_USER_SETTINGS",
	"VERIFICATION_AGENT",
	"VOICE_MODE",
	"WEB_BROWSER_TOOL",
	"WORKFLOW_SCRIPTS",
] as const;

function runCommand(cmd: string[]): string | null {
	const proc = Bun.spawnSync({
		cmd,
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});

	if (proc.exitCode !== 0) {
		return null;
	}

	return new TextDecoder().decode(proc.stdout).trim() || null;
}

function getDevVersion(baseVersion: string): string {
	const timestamp = new Date().toISOString();
	const date = timestamp.slice(0, 10).replaceAll("-", "");
	const time = timestamp.slice(11, 19).replaceAll(":", "");
	const sha =
		runCommand(["git", "rev-parse", "--short=8", "HEAD"]) ?? "unknown";
	return `${baseVersion}-dev.${date}.t${time}.sha${sha}`;
}

function getVersionChangelog(): string {
	return (
		runCommand(["git", "log", "--format=%h %s", "-20"]) ??
		"Local development build"
	);
}

const defaultFeatures = ["VOICE_MODE"];
const featureSet = new Set(defaultFeatures);
for (let i = 0; i < args.length; i += 1) {
	const arg = args[i];
	if (arg === "--feature-set" && args[i + 1]) {
		if (args[i + 1] === "dev-full") {
			for (const feature of fullExperimentalFeatures) {
				featureSet.add(feature);
			}
		}
		i += 1;
		continue;
	}
	if (arg === "--feature-set=dev-full") {
		for (const feature of fullExperimentalFeatures) {
			featureSet.add(feature);
		}
		continue;
	}
	if (arg === "--feature" && args[i + 1]) {
		featureSet.add(args[i + 1]!);
		i += 1;
		continue;
	}
	if (arg.startsWith("--feature=")) {
		featureSet.add(arg.slice("--feature=".length));
	}
}
const features = [...featureSet];

const outfile = compile
	? dev
		? "./dist/fusion-code-dev"
		: "./dist/fusion-code"
	: dev
		? "./fusion-code-dev"
		: "./fusion-code";
const buildTime = new Date().toISOString();
const version = dev ? getDevVersion(pkg.version) : pkg.version;

const outDir = dirname(outfile);
if (outDir !== ".") {
	mkdirSync(outDir, { recursive: true });
}

// @pondwader/socks5-server was dropped during div-anthropic dep slim. The
// vendored sandbox-runtime socks-proxy.js lazy-imports it; externalizing keeps
// the build from hard-failing when the vendored file is present, and the lazy
// import + fail-open path throws a clear error if the SOCKS proxy feature is
// ever invoked without the dep. syntax-highlight libs (highlight.js +
// cli-highlight) stay BUNDLED so the compiled binary keeps code highlighting
// (user requirement: "还是要保留代码高亮，否则开发者不会用的").
const externals = [
	"@ant/*",
	"audio-capture-napi",
	"image-processor-napi",
	"modifiers-napi",
	"url-handler-napi",
	"@pondwader/socks5-server",
];

const defines = {
	"process.env.USER_TYPE": JSON.stringify("external"),
	"process.env.CLAUDE_CODE_FORCE_FULL_LOGO": JSON.stringify("true"),
	...(dev ? { "process.env.NODE_ENV": JSON.stringify("development") } : {}),
	...(dev
		? {
				"process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD": JSON.stringify("true"),
			}
		: {}),
	"process.env.CLAUDE_CODE_VERIFY_PLAN": JSON.stringify("false"),
	"MACRO.VERSION": JSON.stringify(version),
	"MACRO.BUILD_TIME": JSON.stringify(buildTime),
	"MACRO.PACKAGE_URL": JSON.stringify(pkg.name),
	"MACRO.NATIVE_PACKAGE_URL": "undefined",
	"MACRO.FEEDBACK_CHANNEL": JSON.stringify("github"),
	"MACRO.ISSUES_EXPLAINER": JSON.stringify(
		"This reconstructed source snapshot does not include Anthropic internal issue routing.",
	),
	"MACRO.VERSION_CHANGELOG": JSON.stringify(
		dev ? getVersionChangelog() : "https://github.com/fusion-mlxs/fusion-code",
	),
} as const;

// --bytecode precompiles JS to V8/JSC bytecode embedded in the binary.
// Speeds cold start (~100-300ms) but nearly DOUBLES binary size (+72M: 71M→143M).
// Default OFF: binary-size priority over cold-start speed (fusion-code is a
// long-session REPL, cold start happens once). Opt back in with
// FUSION_CODE_BYTECODE=1 for the fast-start build. See memory: binary-size-reduce.
const useBytecode = ["1", "true", "yes"].includes(
	(process.env.FUSION_CODE_BYTECODE ?? "").toLowerCase(),
);

const cmd = [
	"bun",
	"build",
	"./src/entrypoints/cli.tsx",
	"--compile",
	"--target",
	"bun",
	"--format",
	"esm",
	"--outfile",
	outfile,
	"--minify",
	"--packages",
	"bundle",
	"--conditions",
	"bun",
];
if (useBytecode) {
	cmd.push("--bytecode");
}

for (const external of externals) {
	cmd.push("--external", external);
}

for (const feature of features) {
	cmd.push(`--feature=${feature}`);
}

for (const [key, value] of Object.entries(defines)) {
	cmd.push("--define", `${key}=${value}`);
}

const proc = Bun.spawnSync({
	cmd,
	cwd: process.cwd(),
	stdout: "inherit",
	stderr: "inherit",
});

if (proc.exitCode !== 0) {
	process.exit(proc.exitCode ?? 1);
}

if (existsSync(outfile)) {
	chmodSync(outfile, 0o755);
}

console.log(`Built ${outfile}`);
