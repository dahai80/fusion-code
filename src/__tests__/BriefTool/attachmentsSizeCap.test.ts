import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// audit-0902 P2-3: validateAttachmentPaths must reject oversized attachments
// before upload. Pre-fix it checked the sensitive-file gate + isFile but NOT
// size — a 10GB file passed and was uploaded to the cloud transcript,
// exhausting token/memory budget. Post-fix: files over MAX_ATTACHMENT_SIZE
// (25MB) are rejected with a clear message; small files pass.

import { validateAttachmentPaths } from "../../tools/BriefTool/attachments.js";

describe("attachment size cap (audit-0902 P2-3)", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "attach-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("rejects a file exceeding the 25MB cap", async () => {
		const big = join(dir, "big.bin");
		// 26MB > 25MB cap. Write via a sparse-ish buffer to avoid a 26MB
		// allocation in the test: write 1MB head + truncate to size.
		await writeFile(big, Buffer.alloc(1 * 1024 * 1024, 0x41));
		const { truncateSync } = await import("node:fs");
		truncateSync(big, 26 * 1024 * 1024);
		const result = await validateAttachmentPaths([big]);
		expect(result.result).toBe(false);
		if (result.result === false) {
			expect(result.message).toContain("exceeding");
			expect(result.errorCode).toBe(1);
		}
	});

	it("allows a small file under the cap", async () => {
		const small = join(dir, "small.txt");
		await writeFile(small, "hello", "utf8");
		const result = await validateAttachmentPaths([small]);
		expect(result.result).toBe(true);
	});

	it("cap message reports the limit in MB", async () => {
		const big = join(dir, "huge.bin");
		await writeFile(big, Buffer.alloc(1, 0x41));
		const { truncateSync } = await import("node:fs");
		truncateSync(big, 50 * 1024 * 1024);
		const result = await validateAttachmentPaths([big]);
		expect(result.result).toBe(false);
		if (result.result === false) {
			expect(result.message).toContain("25MB");
		}
	});
});
