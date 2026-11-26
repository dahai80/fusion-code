import { describe, expect, test } from "bun:test";
import { toSnapshotPath } from "../../benchmarks/harness-gain/verify.js";

// Regression: transcripts record absolute file_path under the runner's
// temp workdir; the DRA snapshot is rooted at that workdir, so the hg-*
// segment must be stripped before joining (dra.ts replay silently went
// all-ambiguous when the absolute path was joined verbatim).
describe("toSnapshotPath", () => {
    const dir = "/tmp/snap";

    test("strips runner temp workdir prefix from absolute paths", () => {
        expect(
            toSnapshotPath(
                "/private/var/folders/x/T/hg-T02-zGxkOJ/src/hello.py",
                dir,
            ),
        ).toBe(joinTmp(dir, "src/hello.py"));
    });

    test("keeps already-relative paths", () => {
        expect(toSnapshotPath("src/hello.py", dir)).toBe(joinTmp(dir, "src/hello.py"));
    });

    test("falls back to join when no hg- segment present", () => {
        expect(toSnapshotPath("/elsewhere/file.py", dir)).toBe(
            joinTmp(dir, "/elsewhere/file.py"),
        );
    });
});

function joinTmp(dir: string, rel: string): string {
    const { join } = require("node:path");
    return join(dir, rel);
}
