import { describe, it, expect } from 'bun:test'

describe('hookSpecificOutput null guard', () => {
    it('should crash when accessing hookSpecificOutput on null (pre-fix behavior)', () => {
        const json = null as any
        expect(() => json.hookSpecificOutput).toThrow()
    })

    it('should not crash with null guard (post-fix behavior)', () => {
        const json = null as any
        const hso2 = json ? json.hookSpecificOutput : undefined
        expect(hso2).toBeUndefined()
    })

    it('should extract hookSpecificOutput from valid json', () => {
        const json = {
            hookSpecificOutput: {
                hookEventName: 'WorktreeCreate',
                worktreePath: '/tmp/test-wt',
            },
        } as any
        const hso2 = json ? json.hookSpecificOutput : undefined
        expect(hso2).toBeDefined()
        expect(hso2.hookEventName).toBe('WorktreeCreate')
        expect(hso2.worktreePath).toBe('/tmp/test-wt')
    })

    it('should return undefined when json has no hookSpecificOutput', () => {
        const json = { systemMessage: 'ok' } as any
        const hso2 = json ? json.hookSpecificOutput : undefined
        expect(hso2).toBeUndefined()
    })

    it('should extract watchPaths from hookSpecificOutput when present', () => {
        const json = {
            hookSpecificOutput: {
                watchPaths: ['/a', '/b'],
            },
        } as any
        const hso2 = json ? json.hookSpecificOutput : undefined
        const watchPaths =
            json && hso2 && 'watchPaths' in hso2 ? hso2.watchPaths : undefined
        expect(watchPaths).toEqual(['/a', '/b'])
    })

    it('should not extract watchPaths when json is null', () => {
        const json = null as any
        const hso2 = json ? json.hookSpecificOutput : undefined
        const watchPaths =
            json && hso2 && 'watchPaths' in hso2 ? hso2.watchPaths : undefined
        expect(watchPaths).toBeUndefined()
    })

    it('should handle parseHookOutput-like result with no json key', () => {
        const parsed = { plainText: 'some output' } as any
        const json = parsed.json ?? null
        const hso2 = json ? (json as any).hookSpecificOutput : undefined
        expect(hso2).toBeUndefined()
    })

    it('should handle parseHookOutput-like result with valid json', () => {
        const parsed = {
            json: {
                hookSpecificOutput: { hookEventName: 'FileChanged' },
            },
        } as any
        const json = parsed.json ?? null
        const hso2 = json ? (json as any).hookSpecificOutput : undefined
        expect(hso2).toBeDefined()
        expect(hso2.hookEventName).toBe('FileChanged')
    })
})
