#!/usr/bin/env bun
// #203 Phase B (audit 1.1.3): reverse service/UI boundary scanner.
// Consumers OUTSIDE src/services/** may only reach a *migrated* service subdir
// through its barrel (src/services/<subdir>/index), not a deep file. Enforces
// only subdirs listed in the allowlist (scripts/layer-lint-reverse.json
// `migratedSubdirs`) so slices land incrementally without flagging the 28
// subdirs not yet migrated. noRestrictedImports cannot express "deep-but-not-
// barrel" (it forbids a specifier, not a path-suffix pattern) → custom scanner.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = resolve(ROOT, "scripts/layer-lint-reverse.json");

type AllowDeepImport = { file: string; spec: string; reason: string };
type Config = {
	enforcedScope: { root: string; exclude: string[] };
	migratedSubdirs: string[];
	allowDeepImports?: AllowDeepImport[];
};

const config: Config = JSON.parse(readFileSync(CONFIG, "utf8"));
const migrated = new Set(config.migratedSubdirs);
// Exempted deep imports: kept at leaf imports on purpose (e.g. to break an
// eager `export *` runtime cycle). Keyed by `<relFile>\0<spec>` so the match is
// exact per importing file + specifier as written.
const allowedDeep = new Set(
	(config.allowDeepImports ?? []).map((e) => `${e.file}\0${e.spec}`),
);
if (migrated.size === 0) {
	console.log(
		"[layer-lint-reverse] OK: no migrated subdirs configured — nothing to enforce (audit 1.1.3 Phase B).",
	);
	process.exit(0);
}

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const excludeRoots = config.enforcedScope.exclude.map((p) =>
	resolve(ROOT, p).replace(/\/$/, ""),
);
const scopeRoot = resolve(ROOT, config.enforcedScope.root);

// Canonicalize any specifier relative to the importing file's dir to
// `services/<subdir>/<rest>` (no leading ./ ../ src/, no trailing ext). Returns
// null when the specifier does not resolve into src/services/<subdir>/...
function canonicalize(spec: string, fileDir: string): string | null {
	let p = spec;
	// Strip query/fragment fragments Bun allows (e.g. "./x?conditions").
	p = p.replace(/[?#].*$/, "");
	if (p.startsWith("bun:") || p.startsWith("node:") || p.startsWith("@")) {
		// Bare specifiers and virtual modules never reach src/services deep files.
		// (Aliased bare "@scope/..." handled below only if it starts with src.)
		if (!p.startsWith("@") || !p.startsWith("src/")) return null;
	}
	// Alias: absolute "src/..." → treat as rooted at ROOT.
	if (p.startsWith("src/")) {
		p = resolve(ROOT, p);
	} else if (p.startsWith("./") || p.startsWith("../")) {
		p = resolve(fileDir, p);
	} else if (p.startsWith("/")) {
		// absolute fs path (rare); fall through to services check below
	} else {
		return null; // bare specifier (npm package) — not a deep service import
	}
	let rel = relative(ROOT, p).replace(/\\/g, "/");
	// Files live under ROOT/src/, so relative() yields "src/services/...". Strip
	// the "src/" prefix so the canonical form is "services/<subdir>/<rest>"
	// regardless of whether the importer used ./ ../ or "src/..." aliasing.
	if (rel.startsWith("src/")) rel = rel.slice(4);
	if (!rel.startsWith("services/")) return null;
	// services/<subdir>/<rest>
	const parts = rel.split("/"); // ["services", subdir, ...rest]
	if (parts.length < 3) return null; // "services/x" with no file — not a deep import
	const ext = parts[parts.length - 1].match(/\.(ts|tsx|js|jsx)$/);
	if (ext)
		parts[parts.length - 1] = parts[parts.length - 1].slice(0, -ext[0].length);
	return parts.join("/");
}

function walk(dir: string, out: string[]) {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		const full = join(dir, name);
		if (excludeRoots.some((ex) => full === ex || full.startsWith(`${ex}/`))) {
			continue;
		}
		let st: ReturnType<typeof statSync> | undefined;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			walk(full, out);
		} else if (st.isFile() && EXTS.has(name.slice(name.lastIndexOf(".")))) {
			out.push(full);
		}
	}
}

const files: string[] = [];
walk(scopeRoot, files);

// import/require/from specifiers. Captures the string literal path. Handles
// `import x from "p"`, `import { a } from "p"`, `import("p")`, `require("p")`,
// `export ... from "p"`, and dynamic `require("p")`.
const SPEC_RE =
	/(?:\bfrom\b|\brequire\b\s*\(|\bimport\b\s*\(?)\s*["']([^"']+)["']/g;

type Violation = { file: string; line: number; spec: string; subdir: string };
const violations: Violation[] = [];

for (const file of files) {
	let src: string;
	try {
		src = readFileSync(file, "utf8");
	} catch {
		continue;
	}
	const fileDir = file.slice(0, file.lastIndexOf("/"));
	// Match across the whole file then find the line of the match index; a
	// statement may span multiple lines so line-by-line regex would misreport.
	let m: RegExpExecArray | null;
	SPEC_RE.lastIndex = 0;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic RegExp.exec loop
	while ((m = SPEC_RE.exec(src)) !== null) {
		const spec = m[1];
		const canon = canonicalize(spec, fileDir);
		if (!canon) continue;
		// canon = services/<subdir>/<rest...>
		const parts = canon.split("/"); // ["services", subdir, ...rest]
		const subdir = parts[1];
		if (!migrated.has(subdir)) continue;
		const rest = parts.slice(2).join("/");
		// Allowed: barrel only. "index" or "" (dir import resolving to index).
		if (rest === "index" || rest === "") continue;
		const rel = relative(ROOT, file).replace(/\\/g, "/");
		// Exempted leaf import (cycle-break etc.) — declared in allowDeepImports.
		if (allowedDeep.has(`${rel}\0${spec}`)) continue;
		const idx = src.slice(0, m.index).split("\n").length;
		violations.push({ file, line: idx, spec, subdir });
	}
}

const relFiles = violations.map((v) => ({
	...v,
	rel: relative(ROOT, v.file).replace(/\\/g, "/"),
}));

if (relFiles.length === 0) {
	console.log(
		`[layer-lint-reverse] OK: no deep imports past barrels in migrated subdirs {${[...migrated].join(",")}} (audit 1.1.3 Phase B).`,
	);
	process.exit(0);
}

console.error(
	`[layer-lint-reverse] FAIL: ${relFiles.length} deep import(s) past barrels in migrated subdirs (audit 1.1.3 Phase B).`,
);
for (const v of relFiles) {
	console.error(
		`  ${v.rel}:${v.line}: deep import "${v.spec}" → use "src/services/${v.subdir}/index.js" instead`,
	);
}
console.error(
	"  Consumers outside src/services/** must reach a migrated service subdir only through its barrel (src/services/<subdir>/index), not a deep file. Add the deep file's symbols to the barrel if missing.",
);
process.exit(1);
