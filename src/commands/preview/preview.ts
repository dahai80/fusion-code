import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { detectDevServer } from '../../services/dev-server/index.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalCommandCall = async (_args, _context) => {
    const projectDir = getOriginalCwd()
    const info = detectDevServer(projectDir)

    if (!info) {
        return {
            type: 'text',
            value: 'No dev server detected for this project.\n\nEnsure package.json has a "dev" script or a recognized framework is installed.',
        } satisfies LocalCommandResult
    }

    return {
        type: 'text',
        value: `Dev server detected:\n  Framework: ${info.framework}\n  Port: ${info.port}\n  Command: ${info.command}\n\nStart it with:\n  ${info.command}\n\nThen open: http://localhost:${info.port}`,
    } satisfies LocalCommandResult
}
