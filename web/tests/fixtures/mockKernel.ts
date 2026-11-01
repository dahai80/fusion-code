// Mock fusion-code kernel for tests. Emits the stream-json shapes the web
// backend parses (init/assistant/user tool_result/result), then exits.
// Env knobs: MOCK_SESSION_ID (init session_id), MOCK_TEXT, MOCK_TOOL,
// MOCK_PROMPT_UUID (user prompt uuid → checkpoint), MOCK_ARGS_FILE (dump argv).

import { appendFileSync } from 'node:fs';

const sessionId = process.env.MOCK_SESSION_ID ?? '11111111-2222-3333-4444-555555555555';
const text = process.env.MOCK_TEXT ?? 'Plan: fix the bug, then add tests.';
const tool = process.env.MOCK_TOOL ?? 'Bash';
const toolInput = process.env.MOCK_TOOL_INPUT ?? 'bun test auth.test.ts';
const promptUuid = process.env.MOCK_PROMPT_UUID ?? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

if (process.env.MOCK_ARGS_FILE) {
    appendFileSync(process.env.MOCK_ARGS_FILE, `${JSON.stringify(process.argv.slice(2))}\n`);
}

const lines = [
    {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        cwd: process.cwd(),
    },
    {
        type: 'user',
        uuid: promptUuid,
        message: {
            role: 'user',
            content: [{ type: 'text', text: 'Fix the bug and add tests.' }],
        },
    },
    {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [{ type: 'text', text }],
        },
    },
    {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [
                {
                    type: 'tool_use',
                    id: 'toolu_mock_1',
                    name: tool,
                    input: { command: toolInput },
                },
            ],
        },
    },
    {
        type: 'user',
        message: {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 'toolu_mock_1',
                    toolUseResult: tool,
                    content: '12 passed',
                    is_error: false,
                },
            ],
        },
    },
    {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1500,
        num_turns: 3,
        result: 'Done: fixed the bug and added tests.',
        model: 'mock-model',
        usage: { input_tokens: 1200, output_tokens: 300 },
        total_cost_usd: 0.01,
    },
];

for (const line of lines) {
    console.log(JSON.stringify(line));
}
