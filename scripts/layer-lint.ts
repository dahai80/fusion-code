#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = resolve(ROOT, "scripts/layer-lint.json");

const result = spawnSync(
	"bunx",
	["biome", "ci", "--config-path", CONFIG, "src/"],
	{ cwd: ROOT, encoding: "utf8" },
);

const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const ESC = String.fromCharCode(27);
const stripped = out.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

const hits = stripped
	.split("\n")
	.filter((line) => line.includes("noRestrictedImports"));

if (hits.length === 0) {
	console.log(
		"[layer-lint] OK: no react imports in src/services/** (audit 1.1.3)",
	);
	process.exit(0);
}

console.error(
	`[layer-lint] FAIL: ${hits.length} service-layer file(s) import react — bidirectional boundary violation (audit 1.1.3).`,
);
for (const line of hits) {
	const file = line.match(/src\/[^\s]+\.(ts|tsx)/);
	if (file) console.error(`  ${file[0]}`);
}
console.error(
	"  Move the React hook/component to src/hooks/ or src/components/ so the service layer stays UI-free.",
);
process.exit(1);
