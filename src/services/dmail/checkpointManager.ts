import { logForDebugging } from '../../utils/debug.js'

type DmailEntry = {
    id: string
    sessionId: string
    subject: string
    summary: string
    createdAt: number
}

const MAX_DMAILS = 10
const dmails = new Map<string, DmailEntry>()

function generateId(): string {
    return `dm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function registerDmailSummary(sessionId: string, subject: string, summary: string): string {
    const id = generateId()
    dmails.set(id, {
        id,
        sessionId,
        subject,
        summary,
        createdAt: Date.now(),
    })
    pruneDmails(sessionId)
    logForDebugging(`[D-Mail] Registered ${id}: "${subject}"`)
    return id
}

export function getDmailSummary(dmailId: string): string | null {
    const entry = dmails.get(dmailId)
    if (!entry) {
        logForDebugging(`[D-Mail] ${dmailId} not found`)
        return null
    }
    return entry.summary
}

export function getLatestDmailForSession(sessionId: string): string | null {
    const entries = [...dmails.values()]
        .filter(e => e.sessionId === sessionId)
        .sort((a, b) => b.createdAt - a.createdAt)
    return entries.length > 0 ? entries[0]!.summary : null
}

export function listDmails(): Array<{ id: string; subject: string; createdAt: number }> {
    return [...dmails.values()].map(e => ({
        id: e.id,
        subject: e.subject,
        createdAt: e.createdAt,
    }))
}

function pruneDmails(_sessionId: string): void {
    const entries = [...dmails.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt)
    for (let i = MAX_DMAILS; i < entries.length; i++) {
        dmails.delete(entries[i][0])
        logForDebugging(`[D-Mail] Pruned old entry ${entries[i][0]}`)
    }
}
