import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(
    onDone: LocalJSXCommandOnDone,
    context: LocalJSXCommandContext,
    _args: string,
): Promise<React.ReactNode> {
    const { SkillsMenu } = await import('../../components/skills/SkillsMenu.js')
    return <SkillsMenu onExit={onDone} commands={context.options.commands} />
}
