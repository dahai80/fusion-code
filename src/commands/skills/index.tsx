import type { Command } from '../../types/command.js'

const skills: Command = {
    type: 'local-jsx',
    name: 'skills',
    description: 'List available skills',
    load: () => import('./skills.js'), // log: moved call to module via load()
}

export default skills
