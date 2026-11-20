#!/usr/bin/env bun
/**
 * Token/tool efficiency baseline from session jsonl files.
 *
 * Scans session jsonl files under ~/.fusion-code/projects, aggregates per-session
 * turn counts, tool-call counts, token usage, and tool-error rates, and
 * writes a baseline JSON for harness-efficiency tracking.
 *
 * Usage: bun run benchmarks/token-efficiency-baseline.ts [--source DIR] [--out FILE]
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const logger = {
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    warn: (msg: string) => console.warn(`[WARN] ${msg}`),
};

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const sourceDir = argValue("--source") ?? join(homedir(), ".fusion-code", "projects");
const outFile = argValue("--out") ?? join(import.meta.dir, "token-efficiency-baseline.json");

interface SessionStats {
    sessionFile: string;
    projectDir: string;
    turns: number;
    userMessages: number;
    toolCalls: number;
    toolCallsByName: Record<string, number>;
    toolErrors: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    models: string[];
}

function statSession(path: string, projectDir: string): SessionStats | null {
    const stats: SessionStats = {
        sessionFile: basename(path),
        projectDir,
        turns: 0,
        userMessages: 0,
        toolCalls: 0,
        toolCallsByName: {},
        toolErrors: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        models: [],
    };
    const models = new Set<string>();
    let lineNo = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
        lineNo++;
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: any;
        try {
            event = JSON.parse(trimmed);
        } catch {
            logger.warn(`${basename(path)}:${lineNo}: unparseable line, skipped`);
            continue;
        }
        const msg = event.message;
        if (!msg || typeof msg !== "object") continue;
        if (event.type === "user") {
            stats.userMessages++;
            const content = msg.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block?.type === "tool_result" && block.is_error) stats.toolErrors++;
                }
            }
        } else if (event.type === "assistant") {
            stats.turns++;
            const content = msg.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block?.type === "tool_use") {
                        stats.toolCalls++;
                        const name = String(block.name ?? "unknown");
                        stats.toolCallsByName[name] = (stats.toolCallsByName[name] ?? 0) + 1;
                    }
                }
            }
            const usage = msg.usage;
            if (usage && typeof usage === "object") {
                stats.inputTokens += Number(usage.input_tokens ?? 0);
                stats.cacheReadTokens += Number(usage.cache_read_input_tokens ?? 0);
                stats.cacheCreationTokens += Number(usage.cache_creation_input_tokens ?? 0);
                stats.outputTokens += Number(usage.output_tokens ?? 0);
            }
            if (typeof msg.model === "string" && msg.model) models.add(msg.model);
        }
    }
    stats.models = [...models].sort();
    return stats;
}

function main(): void {
    if (!existsSync(sourceDir)) {
        logger.warn(`source dir not found: ${sourceDir}`);
        process.exit(1);
    }
    const sessions: SessionStats[] = [];
    for (const project of readdirSync(sourceDir)) {
        const projectDir = join(sourceDir, project);
        let entries: string[];
        try {
            entries = readdirSync(projectDir);
        } catch {
            continue;
        }
        for (const file of entries) {
            if (!file.endsWith(".jsonl")) continue;
            const path = join(projectDir, file);
            try {
                if (statSync(path).size === 0) continue;
            } catch {
                continue;
            }
            const stats = statSession(path, project);
            if (stats && (stats.turns > 0 || stats.userMessages > 0)) sessions.push(stats);
        }
    }
    logger.info(`parsed ${sessions.length} sessions`);

    const totals = sessions.reduce(
        (acc, s) => ({
            turns: acc.turns + s.turns,
            userMessages: acc.userMessages + s.userMessages,
            toolCalls: acc.toolCalls + s.toolCalls,
            toolErrors: acc.toolErrors + s.toolErrors,
            inputTokens: acc.inputTokens + s.inputTokens,
            cacheReadTokens: acc.cacheReadTokens + s.cacheReadTokens,
            cacheCreationTokens: acc.cacheCreationTokens + s.cacheCreationTokens,
            outputTokens: acc.outputTokens + s.outputTokens,
        }),
        {
            turns: 0, userMessages: 0, toolCalls: 0, toolErrors: 0,
            inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0,
        },
    );
    const toolHistogram: Record<string, number> = {};
    for (const s of sessions) {
        for (const [name, count] of Object.entries(s.toolCallsByName)) {
            toolHistogram[name] = (toolHistogram[name] ?? 0) + count;
        }
    }
    const baseline = {
        generatedAt: new Date().toISOString(),
        harness: "fusion-code",
        harnessVersion: "0.8.5",
        sourceDir,
        sessionCount: sessions.length,
        totals,
        derived: {
            toolCallsPerTurn: totals.turns > 0 ? Number((totals.toolCalls / totals.turns).toFixed(3)) : 0,
            outputTokensPerTurn: totals.turns > 0 ? Math.round(totals.outputTokens / totals.turns) : 0,
            inputTokensPerTurn: totals.turns > 0 ? Math.round(totals.inputTokens / totals.turns) : 0,
            toolErrorRate: totals.toolCalls > 0 ? Number((totals.toolErrors / totals.toolCalls).toFixed(4)) : 0,
        },
        toolHistogram,
        sessions,
    };
    writeFileSync(outFile, JSON.stringify(baseline, null, 4) + "\n");
    logger.info(`baseline written: ${outFile}`);
    console.log(JSON.stringify({ sessionCount: baseline.sessionCount, totals, derived: baseline.derived }, null, 4));
}

main();
