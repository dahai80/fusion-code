import { logForDebugging } from '../../utils/debug.js'
import type {
    ContextCollapseCommitEntry,
    ContextCollapseSnapshotEntry,
} from '../../types/logs.js'

type RestoredCommit = {
    collapseId: string
    summaryUuid: string
    summaryContent: string
    summary: string
    firstArchivedUuid: string
    lastArchivedUuid: string
    archived: unknown[]
}

type RestoredSnapshot = {
    staged: Array<{
        startUuid: string
        endUuid: string
        summary: string
        risk: number
        stagedAt: number
    }>
    armed: boolean
    lastSpawnTokens: number
}

export function restoreFromEntries(
    entries: ContextCollapseCommitEntry[],
    snapshot?: ContextCollapseSnapshotEntry,
): {
    commits: RestoredCommit[]
    snapshot: RestoredSnapshot | null
    maxCollapseId: number
} {
    const commits: RestoredCommit[] = []
    let maxCollapseId = 0

    for (const entry of entries) {
        const numericId = parseInt(entry.collapseId, 10)
        if (!isNaN(numericId) && numericId > maxCollapseId) {
            maxCollapseId = numericId
        }

        commits.push({
            collapseId: entry.collapseId,
            summaryUuid: entry.summaryUuid,
            summaryContent: entry.summaryContent,
            summary: entry.summary,
            firstArchivedUuid: entry.firstArchivedUuid,
            lastArchivedUuid: entry.lastArchivedUuid,
            archived: [],
        })
    }

    let restoredSnapshot: RestoredSnapshot | null = null
    if (snapshot) {
        restoredSnapshot = {
            staged: snapshot.staged.map((s) => ({
                startUuid: s.startUuid,
                endUuid: s.endUuid,
                summary: s.summary,
                risk: s.risk,
                stagedAt: s.stagedAt,
            })),
            armed: snapshot.armed,
            lastSpawnTokens: snapshot.lastSpawnTokens,
        }
    }

    logForDebugging(
        `[contextCollapse] restoreFromEntries: ${commits.length} commits, snapshot=${restoredSnapshot ? 'yes' : 'no'}`,
    )

    return { commits, snapshot: restoredSnapshot, maxCollapseId }
}
