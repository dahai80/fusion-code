import type { UUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../types/command.js'
import {
    getTranscriptPath,
    saveAgentName,
    saveCustomTitle,
} from '../../utils/sessionStorage.js'

const rename: Command = {
    type: 'local-jsx',
    name: 'rename',
    description: 'Rename the current conversation',
    immediate: true,
    argumentHint: '[name]',
    load: () => import('./rename.js'), // log: moved call to module via load()
}

export default rename
