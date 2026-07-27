import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getActiveGoal, getGoalById, getGoalQueue, formatBudgetUsage, isBudgetExceeded } from '../../services/goal/goalState.js'
import { getSessionId } from '../../bootstrap/state.js'
import { GOAL_GET_TOOL_NAME } from './constants.js'

const DESCRIPTION = 'Get the status of the active goal or a specific goal by ID. Shows objective, status, and budget usage.'

const inputSchema = lazySchema(() =>
    z.strictObject({
        goalId: z.string().optional().describe('Goal ID to look up. Omit to get the active goal.'),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        goalId: z.string().describe('The goal ID'),
        objective: z.string().describe('The goal objective'),
        status: z.string().describe('Current status'),
        budget: z.string().describe('Budget usage summary'),
        budgetExceeded: z.boolean().describe('Whether budget has been exceeded'),
        queueSize: z.number().describe('Total goals in queue'),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const GoalGetTool = buildTool({
    name: GOAL_GET_TOOL_NAME,
    searchHint: 'get goal status and budget usage',
    maxResultSizeChars: 10_000,
    async description() {
        return DESCRIPTION
    },
    async prompt() {
        return DESCRIPTION
    },
    get inputSchema(): InputSchema {
        return inputSchema()
    },
    get outputSchema(): OutputSchema {
        return outputSchema()
    },
    async execute({ goalId }, context) {
        const sessionId = getSessionId()
        const goal = goalId
            ? getGoalById(sessionId, goalId)
            : getActiveGoal(sessionId)
        if (!goal) {
            return {
                data: {
                    goalId: 'none',
                    objective: 'No active goal',
                    status: 'none',
                    budget: 'N/A',
                    budgetExceeded: false,
                    queueSize: 0,
                },
            }
        }
        const queue = getGoalQueue(sessionId)
        return {
            data: {
                goalId: goal.id,
                objective: goal.objective,
                status: goal.status,
                budget: formatBudgetUsage(goal),
                budgetExceeded: isBudgetExceeded(goal),
                queueSize: queue.length,
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { goalId, objective, status, budget, budgetExceeded, queueSize } = content as Output
        const exceeded = budgetExceeded ? ' [BUDGET EXCEEDED]' : ''
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: `Goal ${goalId}: "${objective}" (status: ${status}, budget: ${budget}${exceeded}, queue: ${queueSize} goals)`,
        }
    },
} satisfies ToolDef<InputSchema, Output>)
