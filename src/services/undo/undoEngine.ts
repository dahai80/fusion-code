import type { Message } from '../../types/message.js'
export type UndoAnchor = {
    messageId: string
    type: 'user' | 'skill' | 'plugin_command'
    timestamp: number
    text: string
    index: number
}

export type UndoAvailability = {
    canUndo: boolean
    compactionBoundary: number | null
    anchorCount: number
}

function getMessageContentText(msg: Message): string {
    if (msg.type === 'user') {
        const c = msg.message.content
        return typeof c === 'string' ? c : ''
    }
    if (msg.type === 'system' && 'content' in msg) {
        const c = msg.content
        return typeof c === 'string' ? c : ''
    }
    return ''
}

function getMessageId(msg: Message): string {
    if ('uuid' in msg) return msg.uuid as string // log: fix TS2339
    return ''
}

function getMessageTimestamp(msg: Message): number {
    if ('timestamp' in msg && typeof msg.timestamp === 'string') {
        return new Date(msg.timestamp).getTime()
    }
    return 0
}

function isCompactionMessage(msg: Message): boolean {
    if (msg.type !== 'system') return false
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'compact_boundary') return true
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'microcompact_boundary') return true
    const content = getMessageContentText(msg)
    return content.includes('[compaction]') || content.includes('Compaction')
}

function isUserMessage(msg: Message): boolean {
    return msg.type === 'user'
}

function isSkillActivation(msg: Message): boolean {
    if (msg.type !== 'system') return false
    const content = getMessageContentText(msg)
    return content.includes('skill') || content.includes('Skill')
}

function isPluginCommand(msg: Message): boolean {
    if (msg.type !== 'system') return false
    const content = getMessageContentText(msg)
    return content.includes('plugin_command') || content.includes('Plugin')
}

export function findUndoAnchors(messages: Message[]): UndoAnchor[] {
    const anchors: UndoAnchor[] = []
    let lastCompactionIdx = -1

    for (let i = 0; i < messages.length; i++) {
        if (isCompactionMessage(messages[i])) {
            lastCompactionIdx = i
        }
    }

    for (let i = lastCompactionIdx + 1; i < messages.length; i++) {
        const msg = messages[i]
        let type: UndoAnchor['type'] | null = null

        if (isUserMessage(msg)) {
            type = 'user'
        } else if (isSkillActivation(msg)) {
            type = 'skill'
        } else if (isPluginCommand(msg)) {
            type = 'plugin_command'
        }

        if (type) {
            const content = getMessageContentText(msg)
            anchors.push({
                messageId: getMessageId(msg) || `msg_${i}`,
                type,
                timestamp: getMessageTimestamp(msg),
                text: content.slice(0, 100),
                index: i,
            })
        }
    }
    return anchors
}

export function detectCompactionBoundary(messages: Message[]): number | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (isCompactionMessage(messages[i])) return i
    }
    return null
}

export function checkUndoAvailability(messages: Message[]): UndoAvailability {
    const boundary = detectCompactionBoundary(messages)
    const anchors = findUndoAnchors(messages)
    return {
        canUndo: anchors.length > 0,
        compactionBoundary: boundary,
        anchorCount: anchors.length,
    }
}

export function computeUndoSlice(
    messages: Message[],
    count: number,
): { removeFrom: number; anchor: UndoAnchor } | null {
    const anchors = findUndoAnchors(messages)
    if (anchors.length === 0) return null
    const idx = Math.min(count, anchors.length) - 1
    if (idx < 0) return null
    const anchor = anchors[anchors.length - 1 - idx]
    if (!anchor) return null
    return { removeFrom: anchor.index, anchor }
}
