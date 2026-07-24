import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import type { BundledSkillDefinition } from '../../skills/bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'

// Builtin plugin: frontend-design (UI-UX Pro Max)
// Importers: src/plugins/bundled/index.ts → registerFrontendDesignPlugin()
// API: registerBuiltinPlugin(BuiltinPluginDefinition)
// Data schema: BuiltinSkillDefinition { name, description, aliases, whenToUse, getPromptForCommand }
// User instruction: "测试一下git，ecc, UI-UX Pro Max三个skill能否默认打包在fusion-code中"
// Source: ~/.fusion-code/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md

const FRONTEND_DESIGN_PROMPT = `Approach this as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. This client has already rejected proposals that felt templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take one real aesthetic risk you can justify.

## Ground it in the subject

If the brief does not pin down what the product or subject is, pin it yourself before designing: name one concrete subject, its audience, and the page's single job, and state your choice. If there's any information in your memory about the human's preferences, context about what they're building, or designs you've made before – use that as a hint. The subject's own world, its materials, instruments, artifacts, and vernacular, is where distinctive choices come from. Build with the brief's real content and subject matter throughout.

## Design principles

For web designs, the hero is a thesis. Open with the most characteristic thing in the subject's world, in whatever form makes sense for it: a headline, an image, an animation, a live demo, an interactive moment. Be deliberate with your choice: a big number with a small label, supporting stats, and a gradient accent is the template answer, only use if that's truly the best option.

Typography carries the personality of the page. Pair the display and body faces deliberately, not the same families you would reach for on any other project, and set a clear type scale with intentional weights, widths, and spacing. Make the type treatment itself a memorable part of the design, not a neutral delivery vehicle for the content.

Structure is information. Structural devices, numbering, eyebrows, dividers, labels, should encode something true about the content, not decorate it. Many generic designs use numbered markers (01 / 02 / 03), but that's only appropriate if the content actually is a sequence - like a real process or a typed timeline where order carries information the reader needs. Question if choices like numbered markers actually make sense before incorporating them.

Leverage motion deliberately. Think about where and if animation can serve the subject: a page-load sequence, a scroll-triggered reveal, hover micro-interactions, ambient atmosphere. An orchestrated moment usually lands harder than scattered effects; choose what the direction calls for. However, sometimes less is more, and extra animation contributes to the feeling that the design is AI-generated.

Match complexity to the vision. Maximalist directions need elaborate execution; minimal directions need precision in spacing, type, and detail. Elegance is executing the chosen vision well.

Consider written content carefully. Often a design brief may not contain real content, and it's up to you to come up with copy. Copy can make a design feel as templated as the design itself.

## Process: brainstorm, explore, plan, critique, build, critique again

For calibration: AI-generated design right now clusters around three looks: (1) a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta accent; (2) a near-black background with a single bright acid-green or vermilion accent; (3) a broadsheet-style layout with hairline rules, zero border-radius, and dense newspaper-like columns. All three are legitimate for some briefs, but they are defaults rather than choices. Where the brief pins down a visual direction, follow it exactly. Where it leaves an axis free, don't spend that freedom on one of these defaults.

Work in two passes. First, brainstorm a short design plan based on the human's design brief: create a compact token system with color, type, layout, and signature. Then review that plan against the brief before building: if any part of it reads like the generic default — revise that part.

## Restraint and self-critique

Spend your boldness in one place. Let the signature element be the one memorable thing, keep everything around it quiet and disciplined, and cut any decoration that does not serve the brief. Build to a quality floor without announcing it: responsive down to mobile, visible keyboard focus, reduced motion respected.

## Writing in design

Words appear in a design to make it easier to understand. Write from the end user's side of the screen. Name things by what people control and recognize, never by how the system is built. Use active voice as default. A control should say exactly what happens when it's used. Treat failure and emptiness as moments for direction, not mood. Keep the register conversational and tuned: plain verbs, sentence case, no filler.`

const frontendDesignSkill: BundledSkillDefinition = {
    name: 'frontend-design',
    description:
        'Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don\'t read as templated defaults.',
    aliases: ['ui-ux', 'ui-ux-pro-max'],
    whenToUse:
        'Use when building new UI, reshaping existing UI, making design decisions about colors, typography, layout, or when the user asks for design guidance or aesthetic direction.',
    allowedTools: [],
    userInvocable: true,
    getPromptForCommand: async (
        _args: string,
        _context: ToolUseContext,
    ): Promise<ContentBlockParam[]> => {
        logForDebugging('[Skill:frontend-design] generating design prompt')
        return [{ type: 'text', text: FRONTEND_DESIGN_PROMPT }]
    },
}

export function registerFrontendDesignPlugin(): void {
    registerBuiltinPlugin({
        name: 'frontend-design',
        description:
            'Frontend design skill for UI/UX implementation — distinctive visual design guidance',
        version: '1.0.0',
        skills: [frontendDesignSkill],
        defaultEnabled: true,
    })
}
