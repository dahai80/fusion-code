import { describe, expect, it, mock } from "bun:test";

// Tool-name VALUES the builder gates enabledTools against. Inlined as literals:
// statically importing the tool-const modules hoists them ABOVE mock.module()
// calls, so the real REPLTool/constants.ts (which references FILE_READ_TOOL_NAME
// at module top) loads before its mock registers -> TDZ. Literals avoid that
// import entirely; the REPLTool/constants mock below (registered before the
// builder's dynamic import) severs the cycle for the builder's own graph.
const FILE_READ_TOOL_NAME = "Read";
const FILE_WRITE_TOOL_NAME = "Write";
const FILE_EDIT_TOOL_NAME = "Edit";
const GLOB_TOOL_NAME = "Glob";
const GREP_TOOL_NAME = "Grep";
const BASH_TOOL_NAME = "Bash";
const AGENT_TOOL_NAME = "Agent";

// Pure protocol factories — zero imports, cycle-free. Static import is safe.
import {
    getAPIChangeProtocol,
    getBugFixProtocol,
    getCodeReviewProtocol,
    getDatabaseChangeProtocol,
    getDebuggingProtocol,
    getDependencyChangeProtocol,
    getFeatureImplementationProtocol,
    getPerformanceChangeProtocol,
    getRefactoringProtocol,
    getSecurityChangeProtocol,
} from "../../constants/scenario-protocols.js";
import {
    getAPIIntegrationProtocol,
    getCodeMigrationProtocol,
    getConfigChangeProtocol,
    getCrossPlatformProtocol,
    getDeploymentProtocol,
    getDocUpdateProtocol,
    getEnvSetupProtocol,
    getErrorHandlingProtocol,
    getLegacyCodeInteractionProtocol,
    getLoggingProtocol,
    getTestWritingProtocol,
    getTypeSafetyProtocol,
} from "../../constants/micro-scenario-protocols.js";

// Mock memdir with its FULL export surface. memdir.ts imports isReplModeEnabled
// from REPLTool/constants.ts, which references tool-name consts at module top;
// real memdir loaded in an isolated test entry (different init order than the
// production entry) throws a TDZ. But the builder imports getUnameSR from
// prompts.ts, whose own import graph is huge (src/commands.js, exploreAgent,
// claudemd...) and statically binds memdir's OTHER exports (buildMemoryPrompt,
// buildMemoryLines, ...). bun validates mock-module bindings at link time, so a
// partial mock throws "Export named 'buildMemoryPrompt' not found". Providing
// the full surface keeps the link satisfied while short-circuiting the TDZ +
// filesystem side-effects. loadMemoryPrompt reads a mutable so the memory-
// truncation test can drive a long string.
let mockMemoryPrompt = "";
// Mock the 7 tool-const modules the builder imports. The builder uses ONLY the
// *_TOOL_NAME string consts from these, but FileReadTool/prompt.ts transitively
// pulls pdfUtils -> model -> auth -> ... -> builtInAgents -> claudeCodeGuideAgent,
// which closes a cycle back to FileReadTool/prompt mid-init (TDZ at
// claudeCodeGuideAgent.ts:113). The production entry resolves this via cli.tsx
// load order; no practical subset of app-graph mocks severs it. Stubbing the
// tool-const modules at the source cuts the chain — the builder gets its const
// values, the heavy graph never loads. Full export surfaces are stubbed to
// satisfy ES link-time binding for any other consumer.
mock.module("../../tools/FileReadTool/prompt.js", () => ({
    FILE_READ_TOOL_NAME: "Read",
    FILE_UNCHANGED_STUB: "",
    MAX_LINES_TO_READ: 2000,
    DESCRIPTION: "Read a file from the local filesystem.",
    LINE_FORMAT_INSTRUCTION: "",
    OFFSET_INSTRUCTION_DEFAULT: "",
    OFFSET_INSTRUCTION_TARGETED: "",
    renderPromptTemplate: () => "",
}));
mock.module("../../tools/FileWriteTool/prompt.js", () => ({
    FILE_WRITE_TOOL_NAME: "Write",
    DESCRIPTION: "Write a file to the local filesystem.",
    getWriteToolDescription: () => "",
}));
mock.module("../../tools/FileEditTool/constants.js", () => ({
    FILE_EDIT_TOOL_NAME: "Edit",
    CLAUDE_FOLDER_PERMISSION_PATTERN: "/.claude/**",
    GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN: "~/.claude/**",
    FILE_UNEXPECTEDLY_MODIFIED_ERROR: "",
}));
mock.module("../../tools/GlobTool/prompt.js", () => ({
    GLOB_TOOL_NAME: "Glob",
    DESCRIPTION: "",
}));
mock.module("../../tools/GrepTool/prompt.js", () => ({
    GREP_TOOL_NAME: "Grep",
    getDescription: () => "",
}));
mock.module("../../tools/BashTool/toolName.js", () => ({
    BASH_TOOL_NAME: "Bash",
}));
mock.module("../../tools/AgentTool/constants.js", () => ({
    AGENT_TOOL_NAME: "Agent",
    LEGACY_AGENT_TOOL_NAME: "Task",
    VERIFICATION_AGENT_TYPE: "verification",
    ONE_SHOT_BUILTIN_AGENT_TYPES: new Set(["Explore", "Plan"]),
}));

// Mock REPLTool/constants to sever the tool-const init cycle at its TDZ site.
// REPLTool/constants.ts:37 evaluates `REPL_ONLY_TOOLS = new Set([...])` at
// module top, referencing FILE_READ_TOOL_NAME etc. before those leaf consts
// finish initializing (a genuine circular dep the production entry resolves by
// cli.tsx load order). Stubbing it returns a ready Set + a pure isReplModeEnabled
// so the cycle never evaluates against half-initialized consts.
mock.module("../../tools/REPLTool/constants.js", () => ({
    REPL_TOOL_NAME: "REPL",
    isReplModeEnabled: () => false,
    REPL_ONLY_TOOLS: new Set([
        "Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent",
    ]),
}));

mock.module("../../memdir/memdir.js", () => ({
    ENTRYPOINT_NAME: "MEMORY.md",
    MAX_ENTRYPOINT_LINES: 200,
    MAX_ENTRYPOINT_BYTES: 25_000,
    truncateEntrypointContent: (raw: string) => ({ content: raw, truncated: false }),
    DIR_EXISTS_GUIDANCE:
        "This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).",
    DIRS_EXIST_GUIDANCE:
        "Both directories already exist — write to them directly with the Write tool (do not run mkdir or check for their existence).",
    ensureMemoryDirExists: async () => {},
    buildMemoryLines: () => [],
    buildMemoryPrompt: () => "",
    buildSearchingPastContextSection: () => [],
    loadMemoryPrompt: async () => mockMemoryPrompt,
}));

// Mock prompts.ts to a stub getUnameSR. prompts.ts is a giant hub (imports
// src/commands.js, exploreAgent, claudeCodeGuideAgent, the full tool registry)
// whose load order TDZs the tool-const cycle (FILE_READ_TOOL_NAME referenced
// before init in claudeCodeGuideAgent.ts:113). The production entry resolves
// that cycle early via cli.tsx; an isolated test entry that first imports the
// builder resolves it in a different order and crashes. Stubbing prompts.ts
// means its whole graph never loads -> no TDZ. The builder only needs
// getUnameSR (sync string) from prompts.ts; it pushes the dynamic-boundary
// literal STRING itself (line 775), not prompts' exported const, so the
// boundary assertion is unaffected. No other builder-direct dep binds prompts'
// exports, so a single-export stub satisfies link-time binding.
mock.module("../../constants/prompts.js", () => ({
    FUSION_CODE_DOCS_MAP_URL:
        "https://code.fusion-mlx.com/docs/en/fusion_code_docs_map.md",
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY: "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__",
    prependBullets: (items: Array<string | string[]>): string[] =>
        items.flat() as string[],
    getSystemPrompt: async () => "",
    computeEnvInfo: async () => "",
    computeSimpleEnvInfo: async () => "",
    getUnameSR: () => "Darwin 25.5.0",
    DEFAULT_AGENT_PROMPT: "",
    enhanceSystemPromptWithEnvDetails: async () => "",
    getScratchpadInstructions: () => null,
}));

// SUT loaded AFTER all mock.module() calls register (mocks must intercept the
// builder's real side-effect imports). Top-level await is legal in bun ESM and
// runs once at module load, before any describe/it body executes — so the
// exported fns are available synchronously inside describe blocks.
const { getPromptTier, buildMlxSystemPrompt } = await import(
    "../../constants/mlx-system-prompt.js"
);

const ALL_TOOL_NAMES = [
    FILE_READ_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    BASH_TOOL_NAME,
    AGENT_TOOL_NAME,
];

// Builder reads only tools.map(t => t.name) -> Set<string>, so a {name} array
// cast to Tools drives the enabledTools gating branches.
function fakeTools(names: string[]): unknown {
    return names.map((name) => ({ name }));
}

// model IDs that land in each tier via estimateModelParamCount (not exported,
// exercised indirectly through the tier it produces). Suffix-bearing variants
// (e.g. -4bit) are inlined at each call site to cover the suffix-stripping path.
describe("getPromptTier", () => {
    it("paramCount<=3 -> mini", () => {
        expect(getPromptTier(0)).toBe("mini");
        expect(getPromptTier(3)).toBe("mini");
    });

    it("paramCount 4..9 -> standard", () => {
        expect(getPromptTier(4)).toBe("standard");
        expect(getPromptTier(9)).toBe("standard");
    });

    it("paramCount 10..14 -> extended", () => {
        expect(getPromptTier(10)).toBe("extended");
        expect(getPromptTier(14)).toBe("extended");
    });

    it("paramCount>14 + contextWindow<=32768 -> compact", () => {
        expect(getPromptTier(15, 32768)).toBe("compact");
        expect(getPromptTier(15, 8192)).toBe("compact");
        expect(getPromptTier(70, 32768)).toBe("compact");
    });

    it("paramCount>14 + no contextWindow -> full", () => {
        expect(getPromptTier(15)).toBe("full");
        expect(getPromptTier(70)).toBe("full");
    });

    it("paramCount>14 + contextWindow>32768 -> full (just over compact cutoff)", () => {
        expect(getPromptTier(15, 32769)).toBe("full");
        expect(getPromptTier(15, 131072)).toBe("full");
    });
});

// estimateModelParamCount is NOT exported (mlx-system-prompt.ts:794) and has no
// modelId-taking public caller except buildMlxSystemPrompt. The ONLY honest
// indirect path is through buildMlxSystemPrompt (modelId -> internal
// estimateModelParamCount -> tier -> gated sections). So its coverage — suffix
// stripping, size detection, the largest-first guard (27b -> 32 not 7) — lives
// in the buildMlxSystemPrompt tier-gating suite below, which passes real model
// IDs and asserts the tier's section markers. Asserting getPromptTier with a
// hand-copied param count would be a tautology (test my copy vs my copy), so it
// is deliberately NOT done here.

// Pure zero-arg string factories. Assert: non-empty, starts with "# ", contains
// the scenario keyword (case-insensitive). Protocol fns have no imports.
describe("scenario protocols (scenario-protocols.ts)", () => {
    const cases: Array<[string, () => string, RegExp]> = [
        ["getBugFixProtocol", getBugFixProtocol, /bug/i],
        ["getFeatureImplementationProtocol", getFeatureImplementationProtocol, /feature/i],
        ["getRefactoringProtocol", getRefactoringProtocol, /refactor/i],
        ["getCodeReviewProtocol", getCodeReviewProtocol, /code review/i],
        ["getDebuggingProtocol", getDebuggingProtocol, /debug/i],
        ["getDependencyChangeProtocol", getDependencyChangeProtocol, /dependency/i],
        ["getDatabaseChangeProtocol", getDatabaseChangeProtocol, /database/i],
        ["getAPIChangeProtocol", getAPIChangeProtocol, /api/i],
        ["getSecurityChangeProtocol", getSecurityChangeProtocol, /security/i],
        ["getPerformanceChangeProtocol", getPerformanceChangeProtocol, /performance/i],
    ];

    for (const [name, fn, keyword] of cases) {
        it(`${name} returns non-empty "# " heading containing "${keyword.source}"`, () => {
            const out = fn();
            expect(out.length).toBeGreaterThan(0);
            expect(out.startsWith("# ")).toBe(true);
            expect(keyword.test(out)).toBe(true);
        });
    }
});

describe("micro-scenario protocols (micro-scenario-protocols.ts)", () => {
    const cases: Array<[string, () => string, RegExp]> = [
        ["getDeploymentProtocol", getDeploymentProtocol, /deploy/i],
        ["getConfigChangeProtocol", getConfigChangeProtocol, /config/i],
        ["getCodeMigrationProtocol", getCodeMigrationProtocol, /migrat/i],
        ["getEnvSetupProtocol", getEnvSetupProtocol, /environment/i],
        ["getTestWritingProtocol", getTestWritingProtocol, /test/i],
        ["getLoggingProtocol", getLoggingProtocol, /log/i],
        ["getAPIIntegrationProtocol", getAPIIntegrationProtocol, /api/i],
        ["getErrorHandlingProtocol", getErrorHandlingProtocol, /error/i],
        ["getTypeSafetyProtocol", getTypeSafetyProtocol, /type/i],
        ["getLegacyCodeInteractionProtocol", getLegacyCodeInteractionProtocol, /legacy/i],
        ["getDocUpdateProtocol", getDocUpdateProtocol, /doc/i],
        ["getCrossPlatformProtocol", getCrossPlatformProtocol, /platform/i],
    ];

    for (const [name, fn, keyword] of cases) {
        it(`${name} returns non-empty "# " heading containing "${keyword.source}"`, () => {
            const out = fn();
            expect(out.length).toBeGreaterThan(0);
            expect(out.startsWith("# ")).toBe(true);
            expect(keyword.test(out)).toBe(true);
        });
    }
});

// Section markers (first "# " heading each section returns) — sourced from
// mlx-system-prompt.ts. Tests assert presence/absence per tier, NOT exact
// counts (brittle). This catches tier-gating regressions (wrong tier -> wrong
// sections) while surviving prompt-content edits.
const ALL_TIER_MARKERS = ["# Environment", "# Identity", "# Tool usage rules", "# Output style"];
const COMPACT_MARKER = "# Coding standards";
const STANDARD_MARKER = "# Context management";
const EXTENDED_MARKER = "# Security awareness";
const FULL_MARKER = "# Architecture patterns";
const BOUNDARY_LITERAL = "SYSTEM_PROMPT_DYNAMIC_BOUNDARY";

async function buildForTier(model: string, contextWindow?: number): Promise<string[]> {
    return buildMlxSystemPrompt(fakeTools(ALL_TOOL_NAMES) as never, model, [], contextWindow);
}

describe("buildMlxSystemPrompt tier-gating", () => {
    // estimateModelParamCount (NOT exported, :794) exercised indirectly: pass
    // model IDs whose param count lands a known tier, assert tier markers.
    // Covers suffix stripping (-4bit/-mxfp4/-q4) + the largest-first guard
    // (27b must yield param 32 -> full/compact, NOT 7 -> standard).

    it("mini: ALL-tier markers present, compact/standard/extended/full markers absent", async () => {
        // 0.5b -> param 1 -> mini
        const parts = await buildForTier("qwen-0.5b-4bit");
        expect(parts.length).toBeGreaterThan(0);
        expect(parts.every((s) => s.length > 0)).toBe(true);
        for (const m of ALL_TIER_MARKERS) expect(parts.some((s) => s.includes(m))).toBe(true);
        expect(parts.some((s) => s.includes(COMPACT_MARKER))).toBe(false);
        expect(parts.some((s) => s.includes(STANDARD_MARKER))).toBe(false);
        expect(parts.some((s) => s.includes(EXTENDED_MARKER))).toBe(false);
        expect(parts.some((s) => s.includes(FULL_MARKER))).toBe(false);
    });

    it("compact: ALL + compact markers present, standard/extended/full absent", async () => {
        // 27b -> param 32, contextWindow<=32768 -> compact (also tests 27b
        // largest-first guard: 27b -> 32 not 7, so compact/full, not standard)
        const parts = await buildForTier("qwen-27b-4bit", 32768);
        expect(parts.every((s) => s.length > 0)).toBe(true);
        for (const m of ALL_TIER_MARKERS) expect(parts.some((s) => s.includes(m))).toBe(true);
        expect(parts.some((s) => s.includes(COMPACT_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(STANDARD_MARKER))).toBe(false);
        expect(parts.some((s) => s.includes(EXTENDED_MARKER))).toBe(false);
        expect(parts.some((s) => s.includes(FULL_MARKER))).toBe(false);
    });

    it("standard: ALL + compact + standard present, extended/full absent", async () => {
        // 7b -> param 7 -> standard
        const parts = await buildForTier("qwen-7b-mxfp4");
        expect(parts.every((s) => s.length > 0)).toBe(true);
        expect(parts.some((s) => s.includes(COMPACT_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(STANDARD_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(EXTENDED_MARKER))).toBe(false);
        expect(parts.some((s) => s.includes(FULL_MARKER))).toBe(false);
    });

    it("extended: +extended present, full absent", async () => {
        // 14b -> param 14 -> extended
        const parts = await buildForTier("qwen-14b-q4");
        expect(parts.every((s) => s.length > 0)).toBe(true);
        expect(parts.some((s) => s.includes(STANDARD_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(EXTENDED_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(FULL_MARKER))).toBe(false);
    });

    it("full: +full present (72b, no contextWindow)", async () => {
        // 72b -> param 70 -> full
        const parts = await buildForTier("qwen-72b");
        expect(parts.every((s) => s.length > 0)).toBe(true);
        expect(parts.some((s) => s.includes(EXTENDED_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(FULL_MARKER))).toBe(true);
    });

    it("largest-first guard: 27b lands full (param 32), NOT standard (param 7)", async () => {
        // 27b contains "7b" as substring; estimateModelParamCount checks 27b
        // BEFORE 7b (largest-first). If the guard regressed, 27b -> 7 ->
        // standard, and FULL_MARKER ("# Architecture patterns") would be
        // absent. Asserting full here pins the guard.
        const parts = await buildForTier("qwen-27b-bf16");
        expect(parts.some((s) => s.includes(FULL_MARKER))).toBe(true);
        expect(parts.some((s) => s.includes(STANDARD_MARKER))).toBe(true);
    });

    it("dynamic-boundary literal present in every tier", async () => {
        for (const [model, ctx] of [
            ["qwen-0.5b-4bit", undefined],
            ["qwen-27b-4bit", 32768],
            ["qwen-7b-mxfp4", undefined],
            ["qwen-14b-q4", undefined],
            ["qwen-72b", undefined],
        ] as const) {
            const parts = await buildForTier(model, ctx);
            expect(parts.some((s) => s === BOUNDARY_LITERAL)).toBe(true);
        }
    });

    it("scenario protocol content lands at extended+, absent at standard/compact/mini", async () => {
        // getBugFixProtocol pushed at extended+ (:709) with heading
        // "# Bug fix protocol". Assert that exact heading present at
        // extended/full, absent below.
        const BUG_HEADING = "# Bug fix protocol";
        const hasBug = (p: string[]) => p.some((s) => s.includes(BUG_HEADING));
        const mini = await buildForTier("qwen-0.5b-4bit");
        const compact = await buildForTier("qwen-27b-4bit", 32768);
        const standard = await buildForTier("qwen-7b-mxfp4");
        const extended = await buildForTier("qwen-14b-q4");
        const full = await buildForTier("qwen-72b");
        expect(hasBug(mini)).toBe(false);
        expect(hasBug(compact)).toBe(false);
        expect(hasBug(standard)).toBe(false);
        expect(hasBug(extended)).toBe(true);
        expect(hasBug(full)).toBe(true);
    });

    it("tool-gating: tool-examples section emits only enabled tools (standard tier)", async () => {
        // getToolExamplesSection (:196, standard+) gates per-tool: an enabled
        // tool gets a "## <Tool> tool examples" block, an absent one does not.
        // (getToolUsageSection mentions every tool name in its general rules,
        // so it cannot gate — use the examples section.)
        const allParts = await buildForTier("qwen-7b-mxfp4");
        const allExamples = allParts.find((s) => s.startsWith("# Tool call examples")) ?? "";
        expect(allExamples.length).toBeGreaterThan(0);
        expect(allExamples.includes("## Bash tool examples")).toBe(true);
        expect(allExamples.includes("## Grep tool examples")).toBe(true);

        // minimal: only Read+Write enabled at standard tier
        const minParts = await buildMlxSystemPrompt(
            fakeTools(["Read", "Write"]) as never,
            "qwen-7b-mxfp4",
            [],
        );
        const minExamples = minParts.find((s) => s.startsWith("# Tool call examples")) ?? "";
        expect(minExamples.length).toBeGreaterThan(0);
        expect(minExamples.includes("## Read tool examples")).toBe(true);
        expect(minExamples.includes("## Write tool examples")).toBe(true);
        // absent tools -> no example block
        expect(minExamples.includes("## Bash tool examples")).toBe(false);
        expect(minExamples.includes("## Grep tool examples")).toBe(false);
    });
});

describe("buildMlxSystemPrompt memory truncation", () => {
    // compact tier (32B on <=32K context) truncates memoryPrompt > 3000 chars
    // via slice(0, 3000) at :779, appending "... (truncated for context window)".
    // loadMemoryPrompt reads the mutable mockMemoryPrompt, so drive a 4000-char
    // string and assert: (1) no 4000-char element survives, (2) a truncated
    // element (<~3020 chars) carrying the truncation marker appears. Non-compact
    // tiers pass memoryPrompt through untruncated.

    it("compact truncates memory > 3000 chars; no long element survives", async () => {
        mockMemoryPrompt = "M".repeat(4000);
        try {
            const parts = await buildForTier("qwen-27b-4bit", 32768);
            // no element carries the full 4000 chars
            expect(parts.some((s) => s.length >= 4000)).toBe(false);
            // a truncated element with the marker is present
            const truncated = parts.find((s) => s.includes("(truncated for context window)"));
            expect(truncated).toBeDefined();
            expect(truncated?.length ?? 0).toBeLessThan(3100);
            expect(truncated?.length ?? 0).toBeGreaterThan(3000);
        } finally {
            mockMemoryPrompt = "";
        }
    });

    it("full tier does NOT truncate memory (passes through)", async () => {
        const long = "Z".repeat(4000);
        mockMemoryPrompt = long;
        try {
            const parts = await buildForTier("qwen-72b");
            expect(parts.some((s) => s === long)).toBe(true);
            expect(parts.some((s) => s.includes("(truncated for context window)"))).toBe(false);
        } finally {
            mockMemoryPrompt = "";
        }
    });
});
