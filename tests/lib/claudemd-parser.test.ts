/**
 * Tests for claudemd-parser module re-exports.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
	formatMemoryManifest,
	getMemoryFilesPortable,
	getProjectContextPortable,
	MEMORY_TYPES,
	type MemoryHeader,
	parseFrontmatter,
	parseMemoryType,
	scanMemoryFiles,
} from "../../src/lib/claudemd-parser/index.js";

const TEST_DIR = "/tmp/claudemd-parser-test-" + Date.now();

describe("claudemd-parser module", () => {
	it("parseFrontmatter extracts frontmatter and content", () => {
		const md = "---\ndescription: Test file\ntype: project\n---\n\nHello world";
		const result = parseFrontmatter(md);
		expect(result.frontmatter.description).toBe("Test file");
		expect(result.frontmatter.type).toBe("project");
		expect(result.content.trim()).toBe("Hello world");
	});

	it("parseFrontmatter handles no frontmatter", () => {
		const md = "Just plain text";
		const result = parseFrontmatter(md);
		expect(result.frontmatter).toEqual({});
		expect(result.content).toBe("Just plain text");
	});

	it("MEMORY_TYPES contains expected types", () => {
		expect(MEMORY_TYPES).toContain("user");
		expect(MEMORY_TYPES).toContain("feedback");
		expect(MEMORY_TYPES).toContain("project");
		expect(MEMORY_TYPES).toContain("reference");
	});

	it("parseMemoryType validates correctly", () => {
		expect(parseMemoryType("project")).toBe("project");
		expect(parseMemoryType("invalid")).toBeUndefined();
		expect(parseMemoryType(null)).toBeUndefined();
	});

	it("formatMemoryManifest formats headers", () => {
		const headers: MemoryHeader[] = [
			{
				filename: "test.md",
				filePath: "/tmp/test.md",
				mtimeMs: 1700000000000,
				description: "A test memory",
				type: "project",
			},
		];
		const manifest = formatMemoryManifest(headers);
		expect(manifest).toContain("test.md");
		expect(manifest).toContain("[project]");
		expect(manifest).toContain("A test memory");
	});

	it("getMemoryFilesPortable walks project directory", async () => {
		await mkdir(TEST_DIR, { recursive: true });
		await writeFile(
			join(TEST_DIR, "CLAUDE.md"),
			"---\ndescription: Parser test\n---\n\nParser test content",
		);
		try {
			const files = await getMemoryFilesPortable(TEST_DIR);
			const projectFile = files.find(
				(f) => f.path === join(TEST_DIR, "CLAUDE.md"),
			);
			expect(projectFile).toBeDefined();
			expect(projectFile!.type).toBe("Project");
			expect(projectFile!.description).toBe("Parser test");
		} finally {
			await rm(TEST_DIR, { recursive: true, force: true });
		}
	});

	it("getProjectContextPortable returns combined content", async () => {
		await mkdir(TEST_DIR, { recursive: true });
		await writeFile(
			join(TEST_DIR, "CLAUDE.md"),
			"---\ndescription: Context test\n---\n\nContext instructions",
		);
		try {
			const ctx = await getProjectContextPortable(TEST_DIR);
			expect(ctx.cwd).toBe(TEST_DIR);
			expect(ctx.combinedContent).toContain("Context instructions");
			expect(ctx.combinedContent).toContain("project instructions");
		} finally {
			await rm(TEST_DIR, { recursive: true, force: true });
		}
	});
});
