import type { z } from 'zod/v4'
import type { ToolPermissionContext } from '../../Tool.js'
import { splitCommand } from '../../utils/bash/commands.js'
import {
    isAutoModeDangerousCommand,
    isAutoModeSafeCommand,
} from '../../utils/permissions/autoModeDangerList.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import type { BashTool } from './BashTool.js'

const ACCEPT_EDITS_ALLOWED_COMMANDS = [
    'mkdir',
    'touch',
    'rm',
    'rmdir',
    'mv',
    'cp',
    'sed',
] as const

type FilesystemCommand = (typeof ACCEPT_EDITS_ALLOWED_COMMANDS)[number]

function isFilesystemCommand(command: string): command is FilesystemCommand {
    return ACCEPT_EDITS_ALLOWED_COMMANDS.includes(command as FilesystemCommand)
}

function validateCommandForMode(
    cmd: string,
    toolPermissionContext: ToolPermissionContext,
): PermissionResult {
    const trimmedCmd = cmd.trim()
    const [baseCmd] = trimmedCmd.split(/\s+/)

    if (!baseCmd) {
        return {
            behavior: 'passthrough',
            message: 'Base command not found',
        }
    }

    // In Accept Edits mode, auto-allow filesystem operations
    if (
        toolPermissionContext.mode === 'acceptEdits' &&
        isFilesystemCommand(baseCmd)
    ) {
        return {
            behavior: 'allow',
            updatedInput: { command: cmd },
            decisionReason: {
                type: 'mode',
                mode: 'acceptEdits',
            },
        }
    }

    // In Auto mode, use deterministic danger/safe command lists
    if (toolPermissionContext.mode === 'auto') {
        if (isAutoModeDangerousCommand(trimmedCmd)) {
            return {
                behavior: 'ask',
                message: `Destructive command requires confirmation in auto mode: ${trimmedCmd}`,
                decisionReason: {
                    type: 'safetyCheck',
                    reason: `Command '${trimmedCmd}' is classified as dangerous in auto mode`,
                    classifierApprovable: false,
                },
            }
        }

        if (isAutoModeSafeCommand(trimmedCmd)) {
            return {
                behavior: 'allow',
                updatedInput: { command: cmd },
                decisionReason: {
                    type: 'mode',
                    mode: 'auto',
                },
            }
        }
    }

    return {
        behavior: 'passthrough',
        message: `No mode-specific handling for '${baseCmd}' in ${toolPermissionContext.mode} mode`,
    }
}

export function checkPermissionMode(
    input: z.infer<typeof BashTool.inputSchema>,
    toolPermissionContext: ToolPermissionContext,
): PermissionResult {
    // Skip if in bypass mode (handled elsewhere)
    if (toolPermissionContext.mode === 'bypassPermissions') {
        return {
            behavior: 'passthrough',
            message: 'Bypass mode is handled in main permission flow',
        }
    }

    // Skip if in dontAsk mode (handled in main permission flow)
    if (toolPermissionContext.mode === 'dontAsk') {
        return {
            behavior: 'passthrough',
            message: 'DontAsk mode is handled in main permission flow',
        }
    }

    const commands = splitCommand(input.command)

    // Check each subcommand
    for (const cmd of commands) {
        const result = validateCommandForMode(cmd, toolPermissionContext)

        // If any command triggers mode-specific behavior, return that result
        if (result.behavior !== 'passthrough') {
            return result
        }
    }

    // In auto mode, if no subcommand was dangerous and none was explicitly safe,
    // auto-allow the command (auto mode approves by default unless dangerous)
    if (toolPermissionContext.mode === 'auto') {
        return {
            behavior: 'allow',
            updatedInput: { command: input.command },
            decisionReason: {
                type: 'mode',
                mode: 'auto',
            },
        }
    }

    // No mode-specific handling needed
    return {
        behavior: 'passthrough',
        message: 'No mode-specific validation required',
    }
}

export function getAutoAllowedCommands(
    mode: ToolPermissionContext['mode'],
): readonly string[] {
    return mode === 'acceptEdits' ? ACCEPT_EDITS_ALLOWED_COMMANDS : []
}
