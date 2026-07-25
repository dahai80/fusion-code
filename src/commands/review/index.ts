import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../../types/command.js'

const REVIEW_PROMPT = (args: string, fix: boolean) => `
You are an expert code reviewer. Follow these steps:

1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs
2. If a PR number is provided, run \`gh pr view <number>\` to get PR details
3. Run \`gh pr diff <number>\` to get the diff
4. Analyze the changes and provide a thorough code review that includes:
   - Overview of what the PR does
   - Analysis of code quality and style
   - Specific suggestions for improvements
   - Any potential issues or risks

Keep your review concise but thorough. Focus on:
- Code correctness
- Following project conventions
- Performance implications
- Test coverage
- Security considerations

Format your review with clear sections and bullet points.
${fix ? `
After completing the review, automatically fix all issues you identified by:
- Editing the relevant files directly to apply your suggested fixes
- Committing the fixes with a descriptive message like "fix: address code review findings"
- If the fixes are substantial, create a separate commit for each category of fix
` : ''}
PR number: ${args}
`

function parseFixFlag(args: string): { cleanArgs: string; fix: boolean } {
    const tokens = args.trim().split(/\s+/)
    let fix = false
    const clean: string[] = []
    for (const t of tokens) {
        if (t === '--fix') {
            fix = true
        } else {
            clean.push(t)
        }
    }
    return { cleanArgs: clean.join(' '), fix }
}

const review: Command = {
    type: 'prompt',
    name: 'code-review',
    aliases: ['review'],
    description: 'Review a pull request (use --fix to auto-apply fixes)',
    argumentHint: '[<pr-number>] [--fix]',
    progressMessage: 'reviewing pull request',
    contentLength: 0,
    source: 'builtin',
    async getPromptForCommand(args): Promise<ContentBlockParam[]> {
        const { cleanArgs, fix } = parseFixFlag(args)
        return [{ type: 'text', text: REVIEW_PROMPT(cleanArgs, fix) }]
    },
}

export default review
