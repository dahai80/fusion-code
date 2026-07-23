import type { Command } from '../../types/command.js'

const skills: Command = {
    type: 'local-jsx',
    name: 'skills',
    description: 'List available skills',
    async call(onDone, context) {
        const { SkillsMenu } = await import('../../components/skills/SkillsMenu.js')
        return <SkillsMenu onExit={onDone} commands={context.options.commands} />
    },
}

export default skills
