/**
 * WS1 测试: DirectoryAdded hook + Notification agent_completed/agent_needs_input
 * 覆盖: HookEvent union, HOOK_EVENTS const, hook input schema,
 *       matcher metadata values, dispatcher signature, fire-and-forget sites.
 */
import { describe, it, expect } from 'bun:test'

describe('WS1 DirectoryAdded — type/const registration', () => {
    it('HOOK_EVENTS const includes DirectoryAdded', async () => {
        const { HOOK_EVENTS } = await import(
            '../../src/entrypoints/sdk/coreTypes.js'
        )
        expect(HOOK_EVENTS).toContain('DirectoryAdded')
    })

    it('coreSchemas HOOK_EVENTS includes DirectoryAdded', async () => {
        const { HOOK_EVENTS: SCHEMA_EVENTS } = await import(
            '../../src/entrypoints/sdk/coreSchemas.js'
        )
        expect(SCHEMA_EVENTS).toContain('DirectoryAdded')
    })

    it('DirectoryAddedHookInputSchema validates canonical input shape', async () => {
        const { DirectoryAddedHookInputSchema } = await import(
            '../../src/entrypoints/sdk/coreSchemas.js'
        )
        const schema = DirectoryAddedHookInputSchema()
        const valid = {
            hook_event_name: 'DirectoryAdded',
            directory: '/tmp/proj',
            source: 'repl_add_dir',
            session_id: 's1',
            transcript_path: '/tmp/t.jsonl',
            cwd: '/tmp/proj',
        }
        const res = schema.safeParse(valid)
        expect(res.success).toBe(true)
    })

    it('DirectoryAddedHookInputSchema rejects invalid source', async () => {
        const { DirectoryAddedHookInputSchema } = await import(
            '../../src/entrypoints/sdk/coreSchemas.js'
        )
        const schema = DirectoryAddedHookInputSchema()
        const bad = {
            hook_event_name: 'DirectoryAdded',
            directory: '/tmp/proj',
            source: 'unknown_source',
            session_id: 's1',
            transcript_path: '/tmp/t.jsonl',
            cwd: '/tmp/proj',
        }
        const res = schema.safeParse(bad)
        expect(res.success).toBe(false)
    })

    it('DirectoryAddedHookInputSchema accepts cli_add_dir source', async () => {
        const { DirectoryAddedHookInputSchema } = await import(
            '../../src/entrypoints/sdk/coreSchemas.js'
        )
        const schema = DirectoryAddedHookInputSchema()
        const valid = {
            hook_event_name: 'DirectoryAdded',
            directory: '/tmp/other',
            source: 'cli_add_dir',
            session_id: 's1',
            transcript_path: '/tmp/t.jsonl',
            cwd: '/tmp/other',
        }
        const res = schema.safeParse(valid)
        expect(res.success).toBe(true)
    })

    it('DirectoryAddedHookSpecificOutputSchema accepts watchPaths', async () => {
        const { DirectoryAddedHookSpecificOutputSchema } = await import(
            '../../src/entrypoints/sdk/coreSchemas.js'
        )
        const schema = DirectoryAddedHookSpecificOutputSchema()
        const res = schema.safeParse({
            hookEventName: 'DirectoryAdded',
            watchPaths: ['/a', '/b'],
        })
        expect(res.success).toBe(true)
    })

    it('DirectoryAddedHookSpecificOutputSchema rejects wrong hookEventName', async () => {
        const { DirectoryAddedHookSpecificOutputSchema } = await import(
            '../../src/entrypoints/sdk/coreSchemas.js'
        )
        const schema = DirectoryAddedHookSpecificOutputSchema()
        const res = schema.safeParse({
            hookEventName: 'FileChanged',
            watchPaths: ['/a'],
        })
        expect(res.success).toBe(false)
    })
})

describe('WS1 DirectoryAdded — dispatcher + metadata', () => {
    it('executeDirectoryAddedHooks exported and is a function', async () => {
        const mod = await import('../../src/utils/hooks.js')
        expect(typeof mod.executeDirectoryAddedHooks).toBe('function')
    })

    it('getHookEventMetadata returns DirectoryAdded metadata', async () => {
        const { getHookEventMetadata } = await import(
            '../../src/utils/hooks/hooksConfigManager.js'
        )
        const meta = getHookEventMetadata([])
        expect(meta.DirectoryAdded).toBeDefined()
        expect(meta.DirectoryAdded.summary).toBeTruthy()
        expect(meta.DirectoryAdded.description).toContain('directory')
    })

    it('groupHooksByEventAndMatcher includes DirectoryAdded group', async () => {
        const { groupHooksByEventAndMatcher } = await import(
            '../../src/utils/hooks/hooksConfigManager.js'
        )
        const grouped = groupHooksByEventAndMatcher(
            { sessionHooks: new Map(), settings: { hooks: {} } } as any,
            [],
        )
        expect(grouped.DirectoryAdded).toBeDefined()
        expect(typeof grouped.DirectoryAdded).toBe('object')
    })
})

describe('WS1 Notification — agent_* matcher values', () => {
    it('Notification matcher values include agent_completed and agent_needs_input', async () => {
        const { getMatcherMetadata } = await import(
            '../../src/utils/hooks/hooksConfigManager.js'
        )
        const meta = getMatcherMetadata('Notification', [])
        expect(meta).toBeDefined()
        expect(meta!.values).toContain('agent_completed')
        expect(meta!.values).toContain('agent_needs_input')
    })

    it('Notification matcher field is notification_type', async () => {
        const { getMatcherMetadata } = await import(
            '../../src/utils/hooks/hooksConfigManager.js'
        )
        const meta = getMatcherMetadata('Notification', [])
        expect(meta!.fieldToMatch).toBe('notification_type')
    })

    it('executeNotificationHooks exported and is a function', async () => {
        const mod = await import('../../src/utils/hooks.js')
        expect(typeof mod.executeNotificationHooks).toBe('function')
    })
})
