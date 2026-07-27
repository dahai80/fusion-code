import type { LocalJSXCommandCall } from '../../types/command.js'
import { getSessionId } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'
import {
    createGoal,
    getActiveGoal,
    getGoalQueue,
    pauseGoal,
    resumeGoal,
    cancelGoal,
    clearAllGoals,
    replaceGoal,
    formatBudgetUsage,
    isBudgetExceeded,
} from '../../services/goal/goalState.js'

type ParsedBudget = {
    turns?: number
    tokens?: number
    wallMs?: number
}

function parseBudgetArgs(args: string): ParsedBudget {
    const budget: ParsedBudget = {}
    const budgetMatch = args.match(/--budget\s+(\S+)/g)
    if (!budgetMatch) return budget
    for (const part of budgetMatch) {
        const kv = part.replace('--budget ', '').split('=')
        if (kv.length === 2) {
            const val = parseInt(kv[1], 10)
            if (!isNaN(val) && val > 0) {
                if (kv[0] === 'turns') budget.turns = val
                else if (kv[0] === 'tokens') budget.tokens = val
                else if (kv[0] === 'wallMs' || kv[0] === 'ms') budget.wallMs = val
            }
        }
    }
    return budget
}

function stripBudgetArgs(args: string): string {
    return args.replace(/--budget\s+\S+/g, '').trim()
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
    const sessionId = getSessionId()
    const trimmed = args.trim()

    if (trimmed === 'clear' || trimmed === 'reset' || trimmed === 'delete') {
        clearAllGoals(sessionId)
        onDone('All goals cleared.')
        return null
    }

    if (trimmed === 'status' || trimmed === '') {
        const active = getActiveGoal(sessionId)
        const queue = getGoalQueue(sessionId)
        if (queue.length === 0) {
            onDone('No goals set. Use /goal <text> to create one.')
            return null
        }
        const lines: string[] = []
        if (active) {
            const exceeded = isBudgetExceeded(active) ? ' [EXCEEDED]' : ''
            lines.push(`▶ Active: "${active.objective}" (${active.status})`)
            lines.push(`  Budget: ${formatBudgetUsage(active)}${exceeded}`)
            lines.push(`  ID: ${active.id}`)
        }
        const pending = queue.filter(g => g.status === 'paused')
        const blocked = queue.filter(g => g.status === 'blocked')
        const completed = queue.filter(g => g.status === 'complete')
        if (pending.length > 0) {
            lines.push(`\nQueued (${pending.length}):`)
            for (const g of pending) {
                lines.push(`  · "${g.objective}" (ID: ${g.id})`)
            }
        }
        if (blocked.length > 0) {
            lines.push(`\nBlocked (${blocked.length}):`)
            for (const g of blocked) {
                lines.push(`  · "${g.objective}" (ID: ${g.id})`)
            }
        }
        if (completed.length > 0) {
            lines.push(`\nCompleted (${completed.length}):`)
            for (const g of completed) {
                lines.push(`  ✓ "${g.objective}"`)
            }
        }
        onDone(lines.join('\n'))
        return null
    }

    if (trimmed === 'pause') {
        const paused = pauseGoal(sessionId)
        if (paused) {
            onDone(`Goal paused: "${paused.objective}"`)
        } else {
            onDone('No active goal to pause.')
        }
        return null
    }

    if (trimmed === 'resume') {
        const resumed = resumeGoal(sessionId)
        if (resumed) {
            onDone(`Goal resumed: "${resumed.objective}"`)
        } else {
            onDone('No paused goal to resume, or an active goal already exists.')
        }
        return null
    }

    if (trimmed === 'cancel') {
        const ok = cancelGoal(sessionId)
        if (ok) {
            onDone('Active goal cancelled.')
        } else {
            onDone('No active goal to cancel.')
        }
        return null
    }

    if (trimmed.startsWith('replace ')) {
        const objective = trimmed.slice(8).trim()
        const replaced = replaceGoal(sessionId, objective)
        if (replaced) {
            onDone(`Goal replaced: "${replaced.objective}"`)
        } else {
            onDone('No active goal to replace.')
        }
        return null
    }

    if (trimmed.startsWith('next ')) {
        const rest = trimmed.slice(5).trim()
        if (rest === 'manage') {
            const queue = getGoalQueue(sessionId)
            const nonActive = queue.filter(g => g.status !== 'active')
            if (nonActive.length === 0) {
                onDone('No queued goals to manage.')
                return null
            }
            const lines = nonActive.map((g, i) => `${i + 1}. [${g.status}] "${g.objective}" (ID: ${g.id})`)
            onDone(`Queued goals:\n${lines.join('\n')}\nUse /goal cancel <id> to remove.`)
            return null
        }
        const budget = parseBudgetArgs(rest)
        const objective = stripBudgetArgs(rest)
        if (!objective) {
            onDone('Usage: /goal next <text> [--budget turns=N]')
            return null
        }
        const goal = createGoal(sessionId, objective, Object.keys(budget).length > 0 ? budget : undefined)
        onDone(`Goal queued: "${goal.objective}" (status: ${goal.status}, ID: ${goal.id})`)
        return null
    }

    // Default: create goal
    const budget = parseBudgetArgs(trimmed)
    const objective = stripBudgetArgs(trimmed)
    if (!objective) {
        onDone('Usage: /goal <text> | status | pause | resume | cancel | clear | replace <text> | next <text>')
        return null
    }
    const goal = createGoal(sessionId, objective, Object.keys(budget).length > 0 ? budget : undefined)
    const budgetStr = Object.keys(budget).length > 0 ? ` (budget: ${formatBudgetUsage(goal)})` : ''
    onDone(`Goal set: "${goal.objective}" (status: ${goal.status}, ID: ${goal.id})${budgetStr}`)
    logForDebugging(`[Goal] Created: ${goal.id} status=${goal.status}`)
    return null
}
