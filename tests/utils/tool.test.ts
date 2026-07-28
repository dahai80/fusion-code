import { describe, it, expect } from 'bun:test'
import { buildTool } from '../../src/Tool.js'
import { z } from 'zod'

const testSchema = z.object({
    name: z.string(),
    value: z.number().optional(),
})

describe('buildTool', () => {
    it('should return a tool with renderToolUseMessage accepting 2 args', () => {
        const tool = buildTool({
            name: 'test-tool',
            inputSchema: testSchema,
            call: async () => ({
                type: 'text' as const,
                text: 'ok',
            }),
        })
        expect(typeof tool.renderToolUseMessage).toBe('function')
        const result = tool.renderToolUseMessage({ name: 'foo' }, {
            verbose: true,
            theme: 'dark' as any,
        })
        expect(result).toBeNull()
    })

    it('should return a tool with renderToolUseMessage accepting 1 arg', () => {
        const tool = buildTool({
            name: 'test-tool',
            inputSchema: testSchema,
            call: async () => ({
                type: 'text' as const,
                text: 'ok',
            }),
        })
        const result = tool.renderToolUseMessage({ name: 'foo' })
        expect(result).toBeNull()
    })

    it('should return a tool with renderToolUseMessage accepting 0 args', () => {
        const tool = buildTool({
            name: 'test-tool',
            inputSchema: testSchema,
            call: async () => ({
                type: 'text' as const,
                text: 'ok',
            }),
        })
        const result = tool.renderToolUseMessage()
        expect(result).toBeNull()
    })

    it('should use custom renderToolUseMessage when provided', () => {
        const tool = buildTool({
            name: 'test-tool',
            inputSchema: testSchema,
            call: async () => ({
                type: 'text' as const,
                text: 'ok',
            }),
            renderToolUseMessage: (
                input: any,
                opts?: { verbose?: boolean; theme?: string },
            ) => {
                const v = opts?.verbose ?? false
                return v ? `verbose: ${input.name}` : `short: ${input.name}`
            },
        })
        expect(tool.renderToolUseMessage({ name: 'foo' }, {
            verbose: true,
            theme: 'dark',
        })).toBe('verbose: foo')
        expect(tool.renderToolUseMessage({ name: 'bar' })).toBe('short: bar')
    })

    it('should spread TOOL_DEFAULTS for missing defaultable keys', () => {
        const tool = buildTool({
            name: 'test-tool',
            inputSchema: testSchema,
            call: async () => ({
                type: 'text' as const,
                text: 'ok',
            }),
        })
        expect(tool.isEnabled()).toBe(true)
        expect(tool.isReadOnly()).toBe(false)
        expect(tool.isConcurrencySafe()).toBe(false)
        expect(tool.isDestructive()).toBe(false)
        expect(tool.userFacingName()).toBe('test-tool')
    })

    it('should not crash when renderToolUseMessage called with empty opts', () => {
        const tool = buildTool({
            name: 'test-tool',
            inputSchema: testSchema,
            call: async () => ({
                type: 'text' as const,
                text: 'ok',
            }),
        })
        expect(() => tool.renderToolUseMessage({}, {})).not.toThrow()
        expect(() => tool.renderToolUseMessage({}, undefined)).not.toThrow()
    })
})
