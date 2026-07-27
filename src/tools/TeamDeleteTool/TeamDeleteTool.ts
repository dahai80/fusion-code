import { z } from 'zod/v4'
import { logEvent } from '../../services/analytics/index.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { TEAM_LEAD_NAME } from '../../utils/swarm/constants.js'
import {
    cleanupTeamDirectories,
    readTeamFile,
    unregisterTeamForSessionCleanup,
} from '../../utils/swarm/teamHelpers.js'
import { clearTeammateColors } from '../../utils/swarm/teammateLayoutManager.js'
import { clearLeaderTeamName } from '../../utils/tasks.js'
import { TEAM_DELETE_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

export type Output = {
    success: boolean
    message: string
    team_name?: string
}

export type Input = z.infer<InputSchema>

export const TeamDeleteTool: Tool<InputSchema, Output> = buildTool({
    name: TEAM_DELETE_TOOL_NAME,
    searchHint: 'disband a swarm team and clean up',
    maxResultSizeChars: 100_000,
    shouldDefer: true,

    userFacingName() {
        return ''
    },

    get inputSchema(): InputSchema {
        return inputSchema()
    },

    isEnabled() {
        return isAgentSwarmsEnabled()
    },

    async description() {
        return 'Clean up team and task directories when the swarm is complete'
    },

    async prompt() {
        return getPrompt()
    },

    mapToolResultToToolResultBlockParam(data, toolUseID) {
        return {
            tool_use_id: toolUseID,
            type: 'tool_result' as const,
            content: [
                {
                    type: 'text' as const,
                    text: jsonStringify(data),
                },
            ],
        }
    },

    async call(_input, context, _canUseTool?, _parentMessage?, _onProgress?) { // log: fixed call signature
        const { setAppState, getAppState } = context
        const appState = getAppState()
        const teamName = appState.teamContext?.teamName

        if (teamName) {
            const teamFile = readTeamFile(teamName)
            if (teamFile) {
                const nonLeadMembers = teamFile.members.filter(
                    m => m.name !== TEAM_LEAD_NAME,
                )
                const activeMembers = nonLeadMembers.filter(m => m.isActive !== false)

                if (activeMembers.length > 0) {
                    const memberNames = activeMembers.map(m => m.name).join(', ')
                    return {
                        data: {
                            success: false,
                            message: `Cannot cleanup team with ${activeMembers.length} active member(s): ${memberNames}. Use requestShutdown to gracefully terminate teammates first.`,
                            team_name: teamName,
                        },
                    }
                }
            }

            await cleanupTeamDirectories(teamName)
            unregisterTeamForSessionCleanup(teamName)
            clearTeammateColors()
            clearLeaderTeamName()

            logEvent('tengu_team_deleted', {
                team_name: teamName as unknown as number, // log: LogEventMetadata only allows boolean|number|undefined
            })
        }

        setAppState(prev => ({
            ...prev,
            teamContext: undefined,
            inbox: {
                messages: [],
            },
        }))

        return {
            data: {
                success: true,
                message: teamName
                    ? `Cleaned up directories and worktrees for team "${teamName}"`
                    : 'No team name found, nothing to clean up',
                team_name: teamName,
            },
        }
    },
})
