import type { WorkflowTemplate } from "./templateManager.js";

const builtinTemplates: WorkflowTemplate[] = [
	{
		name: "bug-fix",
		description: "Systematic bug investigation and fix workflow",
		category: "debugging",
		steps: [
			{
				title: "Reproduce & Analyze",
				prompt:
					"Reproduce the bug and analyze the root cause. Check logs, stack traces, and recent changes.",
				tools: ["Read", "Grep", "Bash"],
			},
			{
				title: "Fix & Verify",
				prompt:
					"Apply the fix and verify the bug is resolved. Run relevant tests.",
				tools: ["Edit", "MultiEdit", "Bash"],
			},
			{
				title: "Regression Check",
				prompt: "Run full test suite to ensure no regressions from the fix.",
				tools: ["Bash"],
			},
		],
	},
	{
		name: "refactor",
		description: "Safe refactoring with behavior preservation",
		category: "code-quality",
		steps: [
			{
				title: "Understand Scope",
				prompt:
					"Analyze the code to refactor. Identify all callers and dependencies.",
				tools: ["Read", "Grep", "Glob", "LSP"],
			},
			{
				title: "Refactor",
				prompt:
					"Apply the refactoring changes incrementally. Keep behavior identical.",
				tools: ["Edit", "MultiEdit"],
			},
			{
				title: "Verify",
				prompt:
					"Run tests to verify no behavior change. Check for any missed references.",
				tools: ["Bash", "Grep"],
			},
		],
	},
	{
		name: "unit-test",
		description: "Generate comprehensive unit tests",
		category: "testing",
		steps: [
			{
				title: "Analyze Target",
				prompt:
					"Read the target code and understand its interface, edge cases, and error paths.",
				tools: ["Read", "LSP"],
			},
			{
				title: "Generate Tests",
				prompt:
					"Write unit tests covering: happy path, edge cases, error handling, boundary conditions.",
				tools: ["Write"],
			},
			{
				title: "Run & Fix",
				prompt: "Run the generated tests and fix any failures.",
				tools: ["Bash", "Edit"],
			},
		],
	},
	{
		name: "code-review",
		description: "Thorough code review with security and performance checks",
		category: "review",
		steps: [
			{
				title: "Read Changes",
				prompt: "Read all changed files and understand the diff.",
				tools: ["Read", "Bash"],
			},
			{
				title: "Review Dimensions",
				prompt:
					"Review for: correctness, security, performance, style, error handling, and edge cases.",
				tools: ["Read", "Grep"],
			},
			{
				title: "Report",
				prompt:
					"Produce a structured review report with severity ratings and actionable suggestions.",
				tools: ["Write"],
			},
		],
	},
	{
		name: "migration",
		description: "API or framework migration workflow",
		category: "migration",
		steps: [
			{
				title: "Audit Usage",
				prompt: "Find all usages of the old API/framework across the codebase.",
				tools: ["Grep", "Glob", "LSP"],
			},
			{
				title: "Migrate",
				prompt:
					"Apply migration changes file by file. Update imports, API calls, and configurations.",
				tools: ["Edit", "MultiEdit"],
			},
			{
				title: "Validate",
				prompt: "Run tests and build to verify migration completeness.",
				tools: ["Bash"],
			},
		],
	},
	{
		name: "scaffold",
		description: "Scaffold a new module or feature",
		category: "generation",
		steps: [
			{
				title: "Design",
				prompt:
					"Analyze the project structure and design the new module's interface and file layout.",
				tools: ["Read", "Glob", "LSP"],
			},
			{
				title: "Implement",
				prompt:
					"Create the module files with initial implementation and types.",
				tools: ["Write"],
			},
			{
				title: "Integrate",
				prompt:
					"Wire the new module into the existing codebase. Add exports and registrations.",
				tools: ["Edit"],
			},
		],
	},
	{
		name: "docs-gen",
		description: "Generate documentation from code",
		category: "documentation",
		steps: [
			{
				title: "Analyze Code",
				prompt:
					"Read the target code and extract public API surface, types, and behavior.",
				tools: ["Read", "LSP"],
			},
			{
				title: "Generate Docs",
				prompt:
					"Write documentation: API reference, usage examples, and architecture notes.",
				tools: ["Write", "Edit"],
			},
		],
	},
	{
		name: "git-workflow",
		description: "Structured git commit and PR workflow",
		category: "git",
		steps: [
			{
				title: "Stage & Commit",
				prompt:
					"Review changes, stage appropriate files, and create a well-structured commit message.",
				tools: ["Bash"],
			},
			{
				title: "Push & PR",
				prompt:
					"Push the branch and create a pull request with a detailed description.",
				tools: ["Bash"],
			},
		],
	},
	{
		name: "perf-analysis",
		description: "Performance profiling and optimization",
		category: "performance",
		steps: [
			{
				title: "Profile",
				prompt:
					"Identify performance bottlenecks. Check algorithm complexity, memory usage, and I/O patterns.",
				tools: ["Read", "Bash", "Grep"],
			},
			{
				title: "Optimize",
				prompt: "Apply optimizations targeting the identified bottlenecks.",
				tools: ["Edit", "MultiEdit"],
			},
			{
				title: "Benchmark",
				prompt:
					"Measure the improvement with benchmarks or timing comparisons.",
				tools: ["Bash"],
			},
		],
	},
];

export function getBuiltinTemplates(): WorkflowTemplate[] {
	return builtinTemplates;
}

export function getBuiltinTemplate(name: string): WorkflowTemplate | undefined {
	return builtinTemplates.find((t) => t.name === name);
}
