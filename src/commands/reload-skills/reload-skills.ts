import { clearCommandsCache } from '../../commands.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (_args, _context) => {
    clearCommandsCache()
    return { type: 'text', value: 'Skills and commands reloaded' }
}
