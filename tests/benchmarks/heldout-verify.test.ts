import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "../../benchmarks/harness-gain/verify.js";
import { readFileSync } from "node:fs";

// Held-out verify specs must resolve against verify() itself with a
// canned correct solution, and fail on the untouched fixture. The first
// milestone run shipped specs with wrong field names (path/all/expect
// instead of test/specs/stdout) because the smoke test bypassed verify().
const suite = JSON.parse(
    readFileSync(
        join(import.meta.dir, "..", "..", "benchmarks/harness-gain/tasks.json"),
        "utf8",
    ),
);
const heldout = suite.tasks.filter((t: any) => t.heldout);

const solutions: Record<string, (dir: string) => void> = {
    H01: (dir) => {
        writeFileSync(join(dir, "greet.sh"), "echo hello\n");
        chmodSync(join(dir, "greet.sh"), 0o755);
    },
    H02: (dir) => {
        writeFileSync(
            join(dir, "sum_to.py"),
            "def sum_to(n):\n    total = 0\n    for i in range(1, n + 1):\n        total += i\n    return total\n",
        );
    },
    H03: (dir) => {
        for (const f of ["client.py", "worker.py"]) {
            const p = join(dir, f);
            writeFileSync(
                p,
                readFileSync(p, "utf8").replace(
                    "from utils.net import fetch_data",
                    "from utils.http import fetch_data",
                ),
            );
        }
    },
    H04: (dir) => {
        writeFileSync(
            join(dir, "parser.py"),
            "def parse_price(text):\n    cleaned = text.replace('$', '').replace(',', '').strip()\n    if not cleaned:\n        raise ValueError('empty price')\n    return float(cleaned)\n",
        );
    },
    H05: (dir) => {
        writeFileSync(
            join(dir, "lru.py"),
            "from collections import OrderedDict\n\nclass LRUCache:\n    def __init__(self, capacity):\n        self.capacity = capacity\n        self.data = OrderedDict()\n\n    def get(self, key):\n        if key not in self.data:\n            return -1\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key, value):\n        if key in self.data:\n            self.data.move_to_end(key)\n        self.data[key] = value\n        if len(self.data) > self.capacity:\n            self.data.popitem(last=False)\n",
        );
    },
};

const cleanups: string[] = [];

afterEach(() => {
    for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
    cleanups.length = 0;
});

function fixtureDir(taskId: string, solved: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), `heldout-${taskId}-`));
    cleanups.push(dir);
    // Minimal inline fixtures mirroring run.ts FIXTURES (kept in sync by
    // this test failing if verify specs drift).
    const files: Record<string, string> = {};
    if (taskId === "H02") {
        files["sum_to.py"] =
            "def sum_to(n):\n    total = 0\n    for i in range(1, n):\n        total += i\n    return total\n";
        files["tests/test_sum.py"] =
            "from sum_to import sum_to\n\ndef test_five():\n    assert sum_to(5) == 15\n\ndef test_one():\n    assert sum_to(1) == 1\n\ndef test_ten():\n    assert sum_to(10) == 55\n";
    } else if (taskId === "H03") {
        files["utils/__init__.py"] = "";
        files["utils/http.py"] =
            "def fetch_data(url):\n    return {'url': url, 'ok': True}\n";
        files["utils/net.py"] =
            "# legacy module\nfrom utils.http import fetch_data\n";
        files["client.py"] = "from utils.net import fetch_data\n\ndef run():\n    return fetch_data('http://example.com')\n";
        files["worker.py"] = "from utils.net import fetch_data\n\ndef work():\n    return fetch_data('http://worker.local')\n";
        files["tests/test_http.py"] =
            "from utils.http import fetch_data\nfrom client import run\nfrom worker import work\n\ndef test_fetch():\n    assert fetch_data('u')['ok'] is True\n\ndef test_client():\n    assert run()['url'] == 'http://example.com'\n\ndef test_worker():\n    assert work()['url'] == 'http://worker.local'\n";
    } else if (taskId === "H04") {
        files["parser.py"] =
            "def parse_price(text):\n    try:\n        cleaned = text.replace('$', '').replace(',', '').strip()\n        return float(cleaned)\n    except ValueError:\n        return 0.0\n";
        files["tests/test_parser.py"] =
            "import pytest\nfrom parser import parse_price\n\ndef test_valid():\n    assert parse_price('$1,299.50') == 1299.50\n\ndef test_plain():\n    assert parse_price('42') == 42.0\n\ndef test_invalid_raises():\n    with pytest.raises(ValueError):\n        parse_price('not-a-price')\n\ndef test_empty_raises():\n    with pytest.raises(ValueError):\n        parse_price('')\n";
    } else if (taskId === "H05") {
        files["lru.py"] = "";
        files["tests/test_lru.py"] =
            "from lru import LRUCache\n\ndef test_put_get():\n    c = LRUCache(2)\n    c.put('a', 1)\n    assert c.get('a') == 1\n\ndef test_eviction():\n    c = LRUCache(2)\n    c.put('a', 1)\n    c.put('b', 2)\n    c.put('c', 3)\n    assert c.get('a') == -1\n    assert c.get('b') == 2\n\ndef test_recency_update():\n    c = LRUCache(2)\n    c.put('a', 1)\n    c.put('b', 2)\n    c.get('a')\n    c.put('c', 3)\n    assert c.get('b') == -1\n    assert c.get('a') == 1\n\ndef test_overwrite():\n    c = LRUCache(1)\n    c.put('a', 1)\n    c.put('a', 9)\n    assert c.get('a') == 9\n";
    }
    for (const [rel, content] of Object.entries(files)) {
        mkdirSync(join(dir, rel, ".."), { recursive: true });
        writeFileSync(join(dir, rel), content);
    }
    if (solved) solutions[taskId](dir);
    return dir;
}

describe("held-out verify specs", () => {
    for (const task of heldout) {
        test(`${task.id} spec resolves on the correct solution`, () => {
            const dir = fixtureDir(task.id, true);
            const r = verify(task.verify, dir);
            expect(r.detail).toBeString();
            expect(r.resolved).toBe(true);
        });
        if (task.id !== "H01") {
            test(`${task.id} spec fails on the untouched fixture`, () => {
                const dir = fixtureDir(task.id, false);
                expect(verify(task.verify, dir).resolved).toBe(false);
            });
        }
    }
});
