import { log } from './config';

// Issue #241: curated workflow-command registry exposed to the web GUI.
// Entries are natural-language PROMPT templates, not kernel slash commands —
// print mode (-p) deliberately skips slash handling, so the palette fills the
// composer with an equivalent prompt that the kernel executes as a turn.

export type WorkflowCommand = {
    name: string;
    descriptionEn: string;
    descriptionZh: string;
    category: 'plan' | 'review' | 'security' | 'git' | 'quality' | 'docs';
    prompt: string;
};

export const WORKFLOW_COMMANDS: WorkflowCommand[] = [
    {
        name: 'plan',
        descriptionEn: 'Draft an implementation plan before touching code',
        descriptionZh: '动手前先产出实现方案',
        category: 'plan',
        prompt: 'Draft an implementation plan for the feature or fix I am about to describe. List the files to change, the order of work, risks, and a verification step for each stage. Do not write code yet. My request: ',
    },
    {
        name: 'todo',
        descriptionEn: 'Break my request into a tracked task list, then execute',
        descriptionZh: '拆解为任务清单并逐步执行',
        category: 'plan',
        prompt: 'Break my request into a numbered task list with acceptance criteria, then work through it task by task, reporting progress after each. My request: ',
    },
    {
        name: 'review',
        descriptionEn: 'Review the working diff for correctness bugs',
        descriptionZh: '审查当前 diff 的正确性问题',
        category: 'review',
        prompt: 'Review the current uncommitted diff (git diff plus untracked files). Report only real defects: correctness bugs, race conditions, error handling gaps, and edge cases. One line per finding with file:line, severity, and a suggested fix. Do not restyle or refactor.',
    },
    {
        name: 'review-pr',
        descriptionEn: 'Review the open PR / latest commit for regressions',
        descriptionZh: '审查 PR / 最近提交的回归风险',
        category: 'review',
        prompt: 'Review the latest commit (or the open PR branch diff against main) for regressions and incomplete work: missed call sites, broken tests, behavior changes not covered by tests. Report findings with file:line and a concrete fix.',
    },
    {
        name: 'simplify',
        descriptionEn: 'Simplify the diff: reuse, dead code, over-abstraction',
        descriptionZh: '简化本次改动：复用、去死代码、去过抽象',
        category: 'review',
        prompt: 'Look at the current uncommitted diff and propose (then apply) simplifications: reuse existing helpers instead of new code, remove speculative abstractions, collapse duplication. Keep behavior identical and tests green.',
    },
    {
        name: 'security-review',
        descriptionEn: 'Security pass over the working diff',
        descriptionZh: '对当前 diff 做安全审查',
        category: 'security',
        prompt: 'Perform a security review of the current uncommitted diff. Check: injection (shell/SQL/path), secrets in code or logs, unsafe deserialization, auth/authz gaps, SSRF, and unsafe file writes. One finding per line with file:line, severity (critical/high/medium/low), and remediation. Do not fix, report first.',
    },
    {
        name: 'secrets-scan',
        descriptionEn: 'Scan the repo working tree for committed secrets',
        descriptionZh: '扫描工作区是否泄露密钥',
        category: 'security',
        prompt: 'Scan the working tree (including untracked files, excluding .git) for hardcoded secrets: API keys, tokens, passwords, private keys, connection strings. Report file:line and the pattern matched, never the secret value itself.',
    },
    {
        name: 'commit-push-pr',
        descriptionEn: 'Stage, commit with a clean message, push, open a PR',
        descriptionZh: '提交、推送并创建 PR',
        category: 'git',
        prompt: 'Review all uncommitted changes, group them into logical commits with conventional-commit messages that describe WHY, push the branch, and open a PR with a summary and test plan. If the worktree is clean, tell me instead of creating an empty commit.',
    },
    {
        name: 'update-branch',
        descriptionEn: 'Rebase / merge latest main and resolve conflicts',
        descriptionZh: '同步主干并解决冲突',
        category: 'git',
        prompt: 'Update this branch with the latest main (prefer rebase if the branch is unpushed, merge otherwise), resolve any conflicts preserving both intents, and re-run the verify command before reporting the result.',
    },
    {
        name: 'release-notes',
        descriptionEn: 'Draft release notes from recent commits',
        descriptionZh: '根据提交生成发布说明',
        category: 'docs',
        prompt: 'Read the commits since the last version tag and draft release notes: a one-line summary, then BREAKING CHANGES / Added / Changed / Fixed sections with commit references. Plain English, no marketing tone.',
    },
    {
        name: 'docs-update',
        descriptionEn: 'Sync README/docs with the current behavior',
        descriptionZh: '让文档与当前行为保持一致',
        category: 'docs',
        prompt: 'Compare the recent code changes against README.md and the relevant docs/ files. Update stale sections so they match current behavior. Keep the existing document structure and language conventions.',
    },
    {
        name: 'verify',
        descriptionEn: 'Run the verify command and fix what breaks',
        descriptionZh: '运行验证命令并修复失败',
        category: 'quality',
        prompt: 'Run this repository verify command (typecheck, lint, tests). For each failure: root-cause it before fixing, then re-run until green or blocked. Report what failed, why, and what you changed.',
    },
    {
        name: 'types-fix',
        descriptionEn: 'Fix typecheck errors without behavior changes',
        descriptionZh: '修复类型错误，不改行为',
        category: 'quality',
        prompt: 'Fix all typecheck errors with minimal diffs. Do not change runtime behavior, do not weaken types with any/casts unless the correct type is genuinely unrepresentable, and explain each non-obvious fix in one line.',
    },
    {
        name: 'test-write',
        descriptionEn: 'Write tests for the recent changes',
        descriptionZh: '为最近改动补测试',
        category: 'quality',
        prompt: 'Write tests covering the recent uncommitted changes: happy path for each new behavior, plus the edge cases and error paths the diff introduces. Match the existing test style and framework; run the suite and report results.',
    },
    {
        name: 'refactor',
        descriptionEn: 'Targeted refactor of a named area (behavior preserved)',
        descriptionZh: '对指定区域做行为保持的重构',
        category: 'quality',
        prompt: 'Refactor the area I name below. Constraints: behavior-preserving, tests stay green, no drive-by improvements outside the named area, match existing patterns over novel abstractions. Area and goal: ',
    },
    {
        name: 'debug',
        descriptionEn: 'Root-cause a failure before fixing it',
        descriptionZh: '先定位根因再修复',
        category: 'quality',
        prompt: 'Investigate the failure I describe below. Reproduce or trace it to the root cause first, state the cause and evidence, then propose the minimal fix. Do not apply workarounds that hide the symptom. Failure: ',
    },
];

export function listCommands(): WorkflowCommand[] {
    return WORKFLOW_COMMANDS;
}

export function logCommandPaletteUse(name: string): void {
    log(`command palette used: ${name}`);
}
