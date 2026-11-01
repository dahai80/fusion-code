// Mock fusion-code kernel for tests. Emits the stream-json shapes the web
// backend parses (init/assistant/user tool_result/result), then exits.
// Env knobs: MOCK_SESSION_ID (init session_id), MOCK_TEXT, MOCK_TOOL.

const sessionId = process.env.MOCK_SESSION_ID ?? '11111111-2222-3333-4444-555555555555';
const text = process.env.MOCK_TEXT ?? 'Plan: fix the bug, then add tests.';
const tool = process.env.MOCK_TOOL ?? 'Bash';
const toolInput = process.env.MOCK_TOOL_INPUT ?? 'bun test auth.test.ts';

const lines = [
    {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        cwd: process.cwd(),
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
    },
];

for (const line of lines) {
    console.log(JSON.stringify(line));
}
