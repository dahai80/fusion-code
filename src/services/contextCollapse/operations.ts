import { logForDebugging } from '../../utils/debug.js'

type CommittedCollapse = {
    collapseId: string
    summaryUuid: string
    summaryContent: string
    summary: string
    firstArchivedUuid: string
    lastArchivedUuid: string
    archived: unknown[]
}

function getUuid(msg: unknown): string | undefined {
    if (msg && typeof msg === 'object') {
        const m = msg as Record<string, unknown>
        if (typeof m.uuid === 'string') return m.uuid
        if (m.message && typeof m.message === 'object') {
            const inner = m.message as Record<string, unknown>
            if (typeof inner.uuid === 'string') return inner.uuid
        }
    }
    return undefined
}

export function projectView<T>(
    messages: T[],
    commits: CommittedCollapse[] = [],
): T[] {
    if (commits.length === 0) return messages

    const archivedUuids = new Set<string>()
    const firstOfSpan = new Map<string, CommittedCollapse>()

    for (const commit of commits) {
        firstOfSpan.set(commit.firstArchivedUuid, commit)
        let inside = false
        for (const msg of commit.archived) {
            const uuid = getUuid(msg)
            if (uuid === commit.firstArchivedUuid) inside = true
            if (uuid) archivedUuids.add(uuid)
            if (uuid === commit.lastArchivedUuid) inside = false
        }
    }

    const result: T[] = []
    for (const msg of messages) {
        const uuid = getUuid(msg)
        if (uuid && archivedUuids.has(uuid)) {
            const commit = firstOfSpan.get(uuid)
            if (commit) {
                result.push({
                    uuid: commit.summaryUuid,
                    role: 'user',
                    content: commit.summaryContent,
                    _isCollapseSummary: true,
                } as T)
                firstOfSpan.delete(uuid)
            }
            continue
        }
        result.push(msg)
    }

    logForDebugging(
        `[contextCollapse] projectView: ${messages.length} → ${result.length} messages (${commits.length} spans)`,
    )
    return result
}
