import {
    getActiveGoal,
    isBudgetExceeded,
    pauseGoal,
    formatBudgetUsage,
} from './goalState.js'
import { logForDebugging } from '../../utils/debug.js'

export type BudgetCheckResult = {
    exceeded: boolean
    goalId: string | null
    message: string | null
}

export function checkBudget(sessionId: string): BudgetCheckResult {
    const goal = getActiveGoal(sessionId)
    if (!goal) {
        return { exceeded: false, goalId: null, message: null }
    }
    const hasBudget = goal.budget.turns != null || goal.budget.tokens != null || goal.budget.wallMs != null
    if (!hasBudget) {
        return { exceeded: false, goalId: goal.id, message: null }
    }
    if (!isBudgetExceeded(goal)) {
        return { exceeded: false, goalId: goal.id, message: null }
    }
    const paused = pauseGoal(sessionId, goal.id)
    if (paused) {
        const usage = formatBudgetUsage(goal)
        const msg = `Goal "${goal.objective}" budget exceeded (${usage}). Goal auto-paused.`
        logForDebugging(`[BudgetEnforcer] ${msg}`)
        return { exceeded: true, goalId: goal.id, message: msg }
    }
    return { exceeded: true, goalId: goal.id, message: 'Budget exceeded but failed to pause goal' }
}
