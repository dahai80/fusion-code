#!/usr/bin/env bun

/**
 * Harness-gain evaluation runner.
 *
 * Runs the fixed 20-task suite (tasks.json) against one harness per
 * invocation, in fresh temp git repos, and writes per-task rows plus a
 * summary. Verification is deterministic (no LLM judging).
 *
 * Usage:
 *   bun run benchmarks/harness-gain/run.ts --harness fusion-code --model mlx-community--Qwen3-8B-4bit [--only T01,T02] [--out DIR]
 */

import { execFile } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { verify } from "./verify.js";

export { verify };


const execFileAsync = promisify(execFile);

const logger = {
	info: (msg: string) => console.log(`[INFO] ${msg}`),
	warn: (msg: string) => console.warn(`[WARN] ${msg}`),
	error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

function argValue(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

// ── fixture generation ────────────────────────────────────────

type Fixture = { files: Record<string, string>; commands?: string[] };

// Filled per task id below; keep deterministic content.
const FIXTURES: Record<string, () => Fixture> = {
	T01: () => ({
		files: { "config.ini": "[server]\nhost=localhost\nport=8080\nretries=3\n" },
	}),
	T02: () => ({ files: { "README.md": "demo repo\n" } }),
	T03: () => ({
		files: {
			"app.py":
				"def main():\n    print(ANSWER)\n\nif __name__ == '__main__':\n    main()\n",
		},
	}),
	T04: () => ({
		files: {
			"utils.py": "def calc(a, b):\n    return a + b\n",
			"main.py": "from utils import calc\n\nprint(calc(1, 2))\n",
		},
	}),
	T05: () => ({
		files: {
			"stats.py": "",
			"__init__.py": "",
			"tests/test_stats.py":
				"from stats import moving_average\n\ndef test_moving_average():\n    assert moving_average([1, 2, 3, 4], 2) == [1.5, 2.5, 3.5]\n    assert moving_average([5], 1) == [5]\n",
		},
	}),
	T06: () => ({
		files: {
			"cart.py":
				"class Cart:\n    def __init__(self):\n        self.items = []\n\n    def add(self, price, qty=1):\n        self.items.append((price, qty))\n\n    def total(self):\n        # bug: forgets quantity\n        return sum(price for price, _ in self.items)\n",
			"tests/test_cart.py":
				"from cart import Cart\n\ndef test_total():\n    c = Cart()\n    c.add(100, 2)\n    c.add(50)\n    assert c.total() == 250\n",
		},
	}),
	T07: () => ({
		files: {
			"lru.py": "",
			"tests/test_lru.py":
				"from lru import LRUCache\n\ndef test_lru():\n    c = LRUCache(2)\n    c.put(1, 1)\n    c.put(2, 2)\n    assert c.get(1) == 1\n    c.put(3, 3)\n    assert c.get(2) == -1\n    c.put(4, 4)\n    assert c.get(1) == -1\n    assert c.get(3) == 3\n    assert c.get(4) == 4\n",
		},
	}),
	T08: () => ({
		files: {
			"api.py":
				"def create_user(name, email, age):\n    if not name or len(name) > 50:\n        return 'bad name'\n    if not email or '@' not in email:\n        return 'bad email'\n    if age is None or age < 0:\n        return 'bad age'\n    return 'ok'\n\ndef update_user(name, email, age):\n    if not name or len(name) > 50:\n        return 'bad name'\n    if not email or '@' not in email:\n        return 'bad email'\n    if age is None or age < 0:\n        return 'bad age'\n    return 'ok'\n\ndef delete_user(name, email, age):\n    if not name or len(name) > 50:\n        return 'bad name'\n    if not email or '@' not in email:\n        return 'bad email'\n    if age is None or age < 0:\n        return 'bad age'\n    return 'ok'\n",
			"tests/test_api.py":
				"import api\n\ndef test_create_ok():\n    assert api.create_user('a', 'a@b.c', 1) == 'ok'\n\ndef test_update_bad():\n    assert api.update_user('', 'x', 1) == 'bad name'\n\ndef test_delete_bad_age():\n    assert api.delete_user('a', 'a@b.c', -1) == 'bad age'\n",
		},
	}),
	T09: () => ({
		files: {
			"data/settings.json":
				'{\n  "verbose": false,\n  "level": 3\n  "name": "demo"\n}\n',
		},
	}),
	T10: () => ({
		files: {
			"src/main.py": "print('ok')\n",
			// CRLF-sensitive: the LAST line has no trailing exit, so the script's
			// exit code is that command's status. With \r endings bash runs
			// `test -f src/main.py\r` (nonexistent filename -> exit 1); after a
			// real line-ending fix it becomes `test -f src/main.py` -> exit 0.
			// (A plain `exit 0\r` line still exits 0 under CRLF, and `set -e\r`
			// errors out without enabling errexit - both would false-positive.)
			"build.sh":
				"#!/bin/bash\r\necho 'building...'\r\ntest -f src/main.py\r\n",
		},
	}),
	T11: () => ({
		files: {
			"src/a.py": "# TODO_FIX_ME later\nvalue = 1\n",
			"src/sub/b.js": "// TODO_FIX_ME in loader\nconsole.log('b')\n",
			"src/sub/deep/c.md": "note: TODO_FIX_ME marker\n",
		},
	}),
	T12: () => ({
		files: {
			"tool.py":
				"import subprocess, sys\n\ndef main():\n    args = sys.argv[1:]\n    if not args:\n        print('usage: tool.py CMD [ARGS...]')\n        return 1\n    subprocess.run(args, check=False)\n    return 0\n\nif __name__ == '__main__':\n    raise SystemExit(main())\n",
		},
	}),
	T13: () => ({
		files: {
			"client.py":
				"import time\n\ndef fetch_with_retry(fn):\n    while True:\n        try:\n            return fn()\n        except TimeoutError:\n            time.sleep(0.1)\n",
			"tests/test_client.py":
				"import pytest\nfrom client import fetch_with_retry\n\ndef test_retry_gives_up():\n    calls = []\n    def fail():\n        calls.append(1)\n        raise TimeoutError\n    with pytest.raises(TimeoutError):\n        fetch_with_retry(fail)\n",
		},
	}),
	T14: () => ({
		files: {
			"sort.py": "",
			"tests/test_sort.py":
				"from sort import merge_sort\n\ndef test_merge_sort():\n    assert merge_sort([3, 1, 2]) == [1, 2, 3]\n    assert merge_sort([]) == []\n    assert merge_sort([2, 2, 1]) == [1, 2, 2]\n",
		},
	}),
	T15: () => ({
		files: {
			"src/plugins/__init__.py":
				"from .welcomer import Welcomer\n\nPLUGINS = [Welcomer]\n",
			"src/plugins/welcomer.py":
				"class Welcomer:\n    name = 'welcomer'\n\n    def greet(self, who):\n        return f'welcome {who}'\n",
			"tests/test_plugins.py":
				"import sys\nsys.path.insert(0, 'src')\nfrom plugins import PLUGINS\n\ndef test_greeter_registered():\n    names = [p.name for p in PLUGINS]\n    assert 'greeter' in names\n\ndef test_greeter_greets():\n    from plugins import PLUGINS\n    greeter = [p for p in PLUGINS if p.name == 'greeter'][0]\n    assert greeter().greet('x') == 'hello x'\n",
		},
	}),
	T16: () => ({
		files: {
			"parser.py":
				"def parse_csv_line(line):\n    # bug: naive split breaks quoted fields\n    return line.split(',')\n",
			"tests/test_parser.py":
				"from parser import parse_csv_line\n\ndef test_simple():\n    assert parse_csv_line('a,b,c') == ['a', 'b', 'c']\n\ndef test_quoted_comma():\n    assert parse_csv_line('a,\"b,c\",d') == ['a', 'b,c', 'd']\n\ndef test_quoted_quotes():\n    assert parse_csv_line('\"say \"\"hi\"\"\",x') == ['say \"hi\"', 'x']\n",
		},
	}),
	T17: () => ({
		files: {
			"difftool.py": "",
			"tests/test_difftool.py":
				"from difftool import diff_lines\n\ndef test_same():\n    assert diff_lines(['a'], ['a']) == []\n\ndef test_changed():\n    out = diff_lines(['a', 'b'], ['a', 'c'])\n    assert any('- b' in l for l in out)\n    assert any('+ c' in l for l in out)\n\ndef test_added():\n    out = diff_lines([], ['x'])\n    assert any('+ x' in l for l in out)\n",
		},
	}),
	T18: () => ({
		files: {
			"models.py":
				"def load_all(spec):\n    rows = []\n    for name, fields in spec.items():\n        if not name or not name.isidentifier():\n            continue\n        cleaned = {}\n        for k, v in fields.items():\n            if k.startswith('_'):\n                continue\n            if isinstance(v, str) and not v:\n                continue\n            cleaned[k] = v\n        rows.append((name, cleaned))\n    return rows\n",
			"tests/test_models.py":
				"from models import load_all\n\ndef test_load_all():\n    spec = {'A': {'x': 1, '_y': 2, 'z': ''}, 'bad name': {'x': 1}}\n    rows = load_all(spec)\n    assert rows == [('A', {'x': 1})]\n",
		},
	}),
	T19: () => ({
		files: {
			"server.py":
				"import threading\nfrom wsgiref.simple_server import make_server\n\nstate = {'count': 0}\n\ndef app(environ, start_response):\n    if environ['PATH_INFO'] == '/counter' and environ['REQUEST_METHOD'] == 'POST':\n        # bug: read-modify-write without lock\n        current = state['count']\n        state['count'] = current + 1\n        start_response('200 OK', [('Content-Type', 'text/plain')])\n        return [str(state['count']).encode()]\n    start_response('404 Not Found', [])\n    return [b'not found']\n\ndef increment_once():\n    current = state['count']\n    state['count'] = current + 1\n    return state['count']\n",
			"tests/test_server.py":
				"from concurrent.futures import ThreadPoolExecutor\nfrom server import increment_once, state\n\ndef test_concurrent_increments():\n    state['count'] = 0\n    with ThreadPoolExecutor(8) as ex:\n        list(ex.map(lambda _: increment_once(), range(100)))\n    assert state['count'] == 100\n",
		},
	}),
	T20: () => ({
		files: {
			"legacy_config.yaml":
				"app:\n  name: demo\n  debug: false\nserver:\n  port: 8080\n  host: localhost\n",
			"loader.py":
				"import yaml\n\ndef load_config(path='legacy_config.yaml'):\n    with open(path) as f:\n        return yaml.safe_load(f)\n",
			"tests/test_loader.py":
				"from loader import load_config\n\ndef test_values():\n    cfg = load_config('app_config.toml')\n    assert cfg['app']['name'] == 'demo'\n    assert cfg['app']['debug'] is False\n    assert cfg['server']['port'] == 8080\n    assert cfg['server']['host'] == 'localhost'\n",
		},
	}),
	// ── held-out tier (H01-H05, tasks.json heldout=true) ─────────
	// Never iterated against; only run with BENCH_HELDOUT=1. Keep these
	// fixtures frozen — editing one invalidates its held-out status.
	H01: () => ({
		files: {
			"README.md": "# greet demo\n",
		},
	}),
	H02: () => ({
		files: {
			"sum_to.py":
				"def sum_to(n):\n    total = 0\n    for i in range(1, n):\n        total += i\n    return total\n",
			"tests/test_sum.py":
				"from sum_to import sum_to\n\ndef test_five():\n    assert sum_to(5) == 15\n\ndef test_one():\n    assert sum_to(1) == 1\n\ndef test_ten():\n    assert sum_to(10) == 55\n",
		},
	}),
	H03: () => ({
		files: {
			"utils/__init__.py": "",
			"utils/http.py":
				"def fetch_data(url):\n    return {'url': url, 'ok': True}\n",
			"utils/net.py":
				"# legacy module kept for backwards compatibility\nfrom utils.http import fetch_data\n",
			"client.py": "from utils.net import fetch_data\n\ndef run():\n    return fetch_data('http://example.com')\n",
			"worker.py": "from utils.net import fetch_data\n\ndef work():\n    return fetch_data('http://worker.local')\n",
			"tests/test_http.py":
				"from utils.http import fetch_data\nfrom client import run\nfrom worker import work\n\ndef test_fetch():\n    assert fetch_data('u')['ok'] is True\n\ndef test_client():\n    assert run()['url'] == 'http://example.com'\n\ndef test_worker():\n    assert work()['url'] == 'http://worker.local'\n",
		},
	}),
	H04: () => ({
		files: {
			"parser.py":
				"def parse_price(text):\n    try:\n        cleaned = text.replace('$', '').replace(',', '').strip()\n        return float(cleaned)\n    except ValueError:\n        return 0.0\n",
			"tests/test_parser.py":
				"import pytest\nfrom parser import parse_price\n\ndef test_valid():\n    assert parse_price('$1,299.50') == 1299.50\n\ndef test_plain():\n    assert parse_price('42') == 42.0\n\ndef test_invalid_raises():\n    with pytest.raises(ValueError):\n        parse_price('not-a-price')\n\ndef test_empty_raises():\n    with pytest.raises(ValueError):\n        parse_price('')\n",
		},
	}),
	H05: () => ({
		files: {
			"lru.py": "",
			"tests/test_lru.py":
				"from lru import LRUCache\n\ndef test_put_get():\n    c = LRUCache(2)\n    c.put('a', 1)\n    assert c.get('a') == 1\n\ndef test_eviction():\n    c = LRUCache(2)\n    c.put('a', 1)\n    c.put('b', 2)\n    c.put('c', 3)\n    assert c.get('a') == -1\n    assert c.get('b') == 2\n\ndef test_recency_update():\n    c = LRUCache(2)\n    c.put('a', 1)\n    c.put('b', 2)\n    c.get('a')\n    c.put('c', 3)\n    assert c.get('b') == -1\n    assert c.get('a') == 1\n\ndef test_overwrite():\n    c = LRUCache(1)\n    c.put('a', 1)\n    c.put('a', 9)\n    assert c.get('a') == 9\n",
		},
	}),
};

function buildFixtureRepo(taskId: string, dir: string): void {
	const gen = FIXTURES[taskId];
	if (!gen) throw new Error(`no fixture for ${taskId}`);
	const fixture = gen();
	for (const [rel, content] of Object.entries(fixture.files)) {
		const path = join(dir, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
}

async function git(dir: string, args: string[]): Promise<void> {
	await execFileAsync("git", ["-C", dir, ...args]);
}

// ── harness drivers ───────────────────────────────────────────

interface HarnessRun {
	exitCode: number;
	timedOut: boolean;
	seconds: number;
	// count of tool-call-shaped plain-text emissions in stdout (the model
	// printing a tool call instead of producing a tool_calls block)
	textEmissions: number;
	// count of silent-stream retries logged by the adapter debug sink
	// (stream completed with no text/tool_use and was re-issued once)
	silentRetries: number;
	// total tokens billed by the engine for the task, summed from the
	// session transcript's assistant message usage blocks (cost-per-task
	// anchoring: quality must be reported with cost, SWE-Lancer style)
	tokensIn: number;
	tokensOut: number;
}

// matches `Name({file_path: ...})` python-call style, `call_<id>{json}`,
// and the `<tools>{...}</tools>` wrapper format
const TOOL_TEXT_RE =
	/(^|\n)\s*[A-Z][A-Za-z_]*\(\{[^{]*\}\)|call_[0-9a-f]{6,}\{|<tools>\{/g;

function countToolShapedText(stdout: string): number {
	const hits = stdout.match(TOOL_TEXT_RE);
	return hits ? hits.length : 0;
}

function loadEngineKey(): string {
	if (process.env.FUSION_ENGINE_KEY) return process.env.FUSION_ENGINE_KEY;
	try {
		const settings = JSON.parse(
			readFileSync(
				join(process.env.HOME ?? "", ".fusion-mlx", "settings.json"),
				"utf8",
			),
		);
		return settings?.auth?.api_key ?? "";
	} catch {
		return "";
	}
}

// Copy the newest session jsonl written by the harness run into the results
// dir (next to the task log) so failures can be root-caused from the full
// turn-by-turn transcript instead of a stdout tail. Best-effort: a missing
// transcript must never fail the run. Returns the copied path, if any.
function copySessionTranscript(
	configDir: string | undefined,
	logPath: string,
): string | undefined {
	if (!configDir) return undefined;
	try {
		const projectsDir = join(configDir, "projects");
		if (!existsSync(projectsDir)) return undefined;
		let newest: { path: string; mtime: number } | undefined;
		for (const proj of readdirSync(projectsDir)) {
			const projDir = join(projectsDir, proj);
			for (const f of readdirSync(projDir)) {
				if (!f.endsWith(".jsonl")) continue;
				const p = join(projDir, f);
				const mtime = statSync(p).mtimeMs;
				if (!newest || mtime > newest.mtime) newest = { path: p, mtime };
			}
		}
		if (!newest) return undefined;
		const dest = logPath.replace(/\.log$/, ".transcript.jsonl");
		copyFileSync(newest.path, dest);
		return dest;
	} catch (e) {
		console.log(`[WARN] transcript copy failed: ${e}`);
		return undefined;
	}
}

// Count tool-call-shaped plain-text emissions from the full session
// transcript. Preferred over counting process stdout: stdout is lost when a
// timed-out task is killed mid-emission (observed on T17: the transcript ends
// with a plain-text `call_<id>{...}` emission but stdout never carried it, so
// textEmit underreported 1 -> 0).
function countToolShapedTextFromTranscript(path: string): number {
	try {
		let hits = 0;
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line) continue;
			const entry = JSON.parse(line) as {
				type?: string;
				message?: { content?: { type?: string; text?: string }[] };
			};
			if (entry.type !== "assistant") continue;
			for (const c of entry.message?.content ?? []) {
				if (c.type === "text" && c.text) hits += countToolShapedText(c.text);
			}
		}
		return hits;
	} catch {
		return 0;
	}
}

// Tar the given directory to outPath. Best-effort (issue #360): a failed
// snapshot logs a warning and never fails the run. Module-level: called
// from both runHarness (DRA) and the main loop (timeout snapshots).
function snapshotWorkdir(cwd: string, outPath: string): void {
    try {
        Bun.spawnSync(["tar", "-cf", outPath, "-C", cwd, "."]);
    } catch (e) {
        console.log(`[WARN] workdir snapshot failed: ${e}`);
    }
}

// Sum input/output tokens from the session transcript's assistant usage
// blocks. Best-effort: unreadable or missing usage fields count as zero.
function sumTokensFromTranscript(path: string): {
    tokensIn: number;
    tokensOut: number;
} {
    try {
        let tokensIn = 0;
        let tokensOut = 0;
        for (const line of readFileSync(path, "utf8").split("\n")) {
            if (!line) continue;
            const entry = JSON.parse(line) as {
                type?: string;
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            };
            if (entry.type !== "assistant") continue;
            const u = entry.message?.usage;
            if (!u) continue;
            tokensIn += u.input_tokens ?? 0;
            tokensOut += u.output_tokens ?? 0;
        }
        return { tokensIn, tokensOut };
    } catch {
        return { tokensIn: 0, tokensOut: 0 };
    }
}

// Poll the local engine health endpoint until it reports ready or the wait
// budget expires. Used to ride out supervisor auto-recovery restarts
// (fusion-supervisor#153) instead of zeroing the rest of the run.
async function waitForEngineHealthy(
	url: string,
	maxWaitS: number,
): Promise<boolean> {
	const deadline = Date.now() + maxWaitS * 1000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/health`, {
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				const body = (await res.json()) as { ready?: boolean };
				if (body.ready !== false) return true;
			}
		} catch {
			// not up yet — keep polling
		}
		await new Promise((r) => setTimeout(r, 3000));
	}
	return false;
}

async function runHarness(
	harness: string,
	prompt: string,
	cwd: string,
	timeoutS: number,
	logPath: string,
): Promise<HarnessRun> {
	const started = Date.now();
	let outText = "";
	let transcriptPath: string | undefined;
	let cmd: string[];
	// fusion-code only: per-task isolated config dir; its session jsonl
	// transcripts land here and are copied next to the task log on exit
	let configDir: string | undefined;
	let env: Record<string, string> = { ...process.env } as Record<
		string,
		string
	>;
	if (harness === "fusion-code") {
		const bin = resolve(import.meta.dir, "..", "..", "fusion-code");
		// -p runs cannot grant write permissions interactively; the suite works in
		// throwaway temp git repos with no network, so blanket-skip permission checks
		// to let the agent actually attempt the task.
		cmd = [
			bin,
			"-p",
			prompt,
			"--max-turns",
			"12",
			"--dangerously-skip-permissions",
			// always-on: the session debug file is the only place the adapter
			// logs silent-stream retries; the runner counts them per task
			"-D",
		];
		const engineKey = loadEngineKey();
		// Isolate from the host user config (~/.fusion-code/settings.json hooks,
		// e.g. RTK command auto-rewrite) so a run measures harness+model, not
		// the host's hook setup. Fresh empty dir per run.
		configDir = mkdtempSync(join(tmpdir(), "fc-bench-cfg-"));
		env = {
			...env,
			FUSION_MLX_ENABLED: "1",
			FUSION_MLX_BASE_URL:
				process.env.FUSION_MLX_BASE_URL ?? "http://127.0.0.1:11434",
			FUSION_CLIENT_KEY: engineKey,
			FUSION_MODEL: process.env.BENCH_MODEL ?? "",
			FUSION_CODE_CONFIG_DIR: configDir,
		};
	} else if (harness === "opencode") {
		cmd = ["opencode", "run", prompt];
	} else if (harness === "goose") {
		// goose quirk: --text and -t are the same flag — passing both eats the
		// prompt. Host must NOT carry a /v1 suffix (goose appends the path).
		const engineKey = loadEngineKey();
		cmd = ["goose", "run", "--text", prompt];
		env = {
			...env,
			// approve/smart-approve require an interactive terminal; auto is
			// the only valid headless mode
			GOOSE_MODE: "auto",
			GOOSE_PROVIDER: "openai",
			GOOSE_MODEL: process.env.BENCH_MODEL ?? "",
			OPENAI_API_KEY: engineKey,
			OPENAI_HOST: process.env.FUSION_MLX_BASE_URL ?? "http://127.0.0.1:11434",
		};
	} else {
		throw new Error(`unknown harness: ${harness}`);
	}
	const timedOut = await new Promise<boolean>((resolveTimeout) => {
		const child = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => {
			child.kill(9);
			resolveTimeout(true);
		}, timeoutS * 1000);
		child.exited.then(async () => {
			clearTimeout(timer);
			try {
				const out = await new Response(child.stdout).text();
				const err = await new Response(child.stderr).text();
				outText = out;
				writeFileSync(
					logPath,
					`CMD: ${cmd.join(" ")}\n\n--- STDOUT ---\n${out}\n\n--- STDERR ---\n${err}\n`,
				);
				transcriptPath = copySessionTranscript(configDir, logPath);
			} catch {}
			resolveTimeout(false);
		});
	});
	// DRA mode: snapshot the final tree so the over-edit replay (dra.ts)
	// can attribute each edit unit. Runs for every task — resolved filtering
	// happens in the replay. Best-effort: a failed snapshot never fails the run.
	if (process.env.BENCH_DRA === "1") {
		const taskId = logPath.replace(/\.log$/, "").split("/").pop()!;
		snapshotWorkdir(cwd, join(dirname(logPath), `${taskId}.final.tar`));
	}
	const tokens = transcriptPath
		? sumTokensFromTranscript(transcriptPath)
		: { tokensIn: 0, tokensOut: 0 };
	return {
		exitCode: 0,
		timedOut,
		seconds: (Date.now() - started) / 1000,
		textEmissions: transcriptPath
			? countToolShapedTextFromTranscript(transcriptPath)
			: countToolShapedText(outText),
		silentRetries: countSilentStreamRetries(configDir),
		tokensIn: tokens.tokensIn,
		tokensOut: tokens.tokensOut,
	};
}

// Count silent-stream retry log lines in the task's session debug file
// (configDir/debug/<sessionId>.txt, enabled by the always-on -D flag).
// Best-effort: a missing or unreadable file counts as zero — this metric
// must never fail a run.
function countSilentStreamRetries(configDir: string | undefined): number {
	if (!configDir) return 0;
	try {
		const debugDir = join(configDir, "debug");
		if (!existsSync(debugDir)) return 0;
		let count = 0;
		for (const f of readdirSync(debugDir)) {
			if (!f.endsWith(".txt")) continue;
			const text = readFileSync(join(debugDir, f), "utf8");
			const matches = text.match(/Silent stream \(no text\/tool_use\)/g);
			if (matches) count += matches.length;
		}
		return count;
	} catch {
		return 0;
	}
}

// ── verification ──────────────────────────────────────────────


// ── main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
	const harness = argValue("--harness");
	if (!harness) {
		logger.error("--harness required (fusion-code | opencode | goose)");
		process.exit(1);
	}
	const suiteDir = import.meta.dir;
	const suite = JSON.parse(readFileSync(join(suiteDir, "tasks.json"), "utf8"));
	const only = argValue("--only")?.split(",") ?? null;
	// Held-out tasks (heldout=true) are excluded unless BENCH_HELDOUT=1 so
	// regular iteration runs never tune against them; --only overrides.
	const heldoutMode = process.env.BENCH_HELDOUT === "1";
	const tasks = suite.tasks.filter(
		(t: any) =>
			(!only || only.includes(t.id)) &&
			(!t.heldout || heldoutMode || only?.includes(t.id)),
	);
	const timeoutS = Number(
		argValue("--timeout") ?? suite.protocol.timeoutSeconds,
	);
	const outDir =
		argValue("--out") ??
		join(
			suiteDir,
			"results",
			`${harness}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
		);
	mkdirSync(outDir, { recursive: true });

	logger.info(
		`harness=${harness} tasks=${tasks.length} timeout=${timeoutS}s out=${outDir}`,
	);
	const rows: any[] = [];
	for (const task of tasks) {
		const workdir = mkdtempSync(join(tmpdir(), `hg-${task.id}-`));
		try {
			// Resume mode (issue #360): BENCH_RESUME_DIR points at a prior
			// results dir; tasks with a timeout snapshot restart from that
			// tree instead of the fresh fixture. Deterministic preamble, no
			// LLM summarization.
			const resumeTar = process.env.BENCH_RESUME_DIR
				? join(process.env.BENCH_RESUME_DIR, `${task.id}.timeout.tar`)
				: undefined;
			const resuming = Boolean(resumeTar && existsSync(resumeTar));
			if (resuming && resumeTar) {
				Bun.spawnSync(["tar", "-xf", resumeTar, "-C", workdir]);
				logger.info(
					`${task.id} resuming from timeout snapshot ${resumeTar}`,
				);
			} else {
				await git(workdir, ["init", "-q"]);
				buildFixtureRepo(task.id, workdir);
				await git(workdir, ["add", "-A"]);
				await git(workdir, [
					"-c",
					"user.email=bench@local",
					"-c",
					"user.name=bench",
					"commit",
					"-qm",
					"fixture",
				]);
			}
			const prompt = resuming
				? `${task.prompt}\n\nThis is a resumed run: a previous attempt timed out with its work already present in the working tree. Continue from the current state, verify what is done, and finish the task.`
				: task.prompt;
			logger.info(
				`${task.id} start (${task.difficulty}/${task.kind})${resuming ? " [resumed]" : ""}`,
			);
			const logPath = join(outDir, `${task.id}.log`);
			let run = await runHarness(
				harness,
				prompt,
				workdir,
				timeoutS,
				logPath,
			);
			// Engine-restart resilience (fusion-supervisor#153): supervisor
			// auto-recovery occasionally SIGTERMs the engine mid-run; sessions
			// launched during the downtime window die instantly with
			// "Local inference service unavailable". Wait for the engine and
			// retry once so an infra blip does not zero the whole run.
			const localLogText = existsSync(logPath)
				? readFileSync(logPath, "utf8")
				: "";
			if (localLogText.includes("Local inference service unavailable")) {
				const engineUrl =
					process.env.FUSION_MLX_BASE_URL ?? "http://127.0.0.1:11434";
				logger.warn(
					`${task.id} engine unavailable, waiting for recovery (max 180s) then retrying once`,
				);
				if (await waitForEngineHealthy(engineUrl, 180)) {
					run = await runHarness(
						harness,
						prompt,
						workdir,
						timeoutS,
						logPath,
					);
				} else {
					logger.error(
						`${task.id} engine did not recover, keeping failed result`,
					);
				}
			}
			const v = verify(task.verify, workdir);
			// Timeout snapshot (issue #360): keep the tree at kill time so a
			// later BENCH_RESUME_DIR run can restart from it instead of a
			// fresh fixture. Skipped for resumed tasks (same snapshot again).
			if (run.timedOut && !resuming) {
				snapshotWorkdir(workdir, join(outDir, `${task.id}.timeout.tar`));
			}
			const row = {
				id: task.id,
				difficulty: task.difficulty,
				kind: task.kind,
				resolved: v.resolved,
				verifyDetail: v.detail,
				timedOut: run.timedOut,
				resumed: resuming,
				wallSeconds: Math.round(run.seconds * 10) / 10,
				textEmissions: run.textEmissions,
				silentRetries: run.silentRetries,
				tokensIn: run.tokensIn,
				tokensOut: run.tokensOut,
				heldout: Boolean(task.heldout),
			};
			rows.push(row);
			logger.info(
				`${task.id} resolved=${v.resolved} wall=${row.wallSeconds}s textEmit=${row.textEmissions} silentRetry=${row.silentRetries} tokens=${row.tokensIn}/${row.tokensOut}`,
			);
		} catch (e) {
			logger.error(`${task.id} failed: ${e}`);
			rows.push({ id: task.id, resolved: false, error: String(e) });
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	}
	const resolvedCount = rows.filter((r) => r.resolved).length;
	// Held-out breakdown (SWE-Bench Pro practice): reported separately so
	// milestone claims can cite a score that never drove iteration.
	const heldoutRows = rows.filter((r) => r.heldout);
	const heldoutResolved = heldoutRows.filter((r) => r.resolved).length;
	const emissionTotal = rows.reduce((s, r) => s + (r.textEmissions ?? 0), 0);
	const silentRetryTotal = rows.reduce((s, r) => s + (r.silentRetries ?? 0), 0);
	const tokensInTotal = rows.reduce((s, r) => s + (r.tokensIn ?? 0), 0);
	const tokensOutTotal = rows.reduce((s, r) => s + (r.tokensOut ?? 0), 0);
	const summary = {
		harness,
		model: process.env.BENCH_MODEL ?? "unset",
		date: new Date().toISOString(),
		suite: suite.suite,
		total: rows.length,
		resolved: resolvedCount,
		resolveRate: rows.length
			? Math.round((resolvedCount / rows.length) * 1000) / 1000
			: 0,
		heldoutTotal: heldoutRows.length,
		heldoutResolved,
		heldoutRate: heldoutRows.length
			? Math.round((heldoutResolved / heldoutRows.length) * 1000) / 1000
			: null,
		textEmissions: emissionTotal,
		silentRetries: silentRetryTotal,
		tokensIn: tokensInTotal,
		tokensOut: tokensOutTotal,
		rows,
	};
	writeFileSync(
		join(outDir, "summary.json"),
		JSON.stringify(summary, null, 4) + "\n",
	);
	logger.info(
		`resolved ${resolvedCount}/${rows.length}; summary at ${join(outDir, "summary.json")}`,
	);
}

if (import.meta.main) {
	main();
}
