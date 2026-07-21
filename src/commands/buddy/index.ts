/**
 * /buddy command — companion hatchery
 *
 * Allows the user to view their companion, re-hatch, or mute/unmute it.
 * The companion is a deterministic sprite derived from the user ID.
 * The BUDDY feature flag controls whether this command is available.
 */

import type { Command } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getCompanion, companionUserId, roll } from '../../buddy/companion.js'
import { RARITY_STARS, RARITY_COLORS, type Companion } from '../../buddy/types.js'

const command: Command = {
  name: 'buddy',
  description: 'View or manage your terminal companion',
  aliases: ['companion', 'pet', 'duck'],
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      call: async (_args: string, _context: any) => {
        return { type: 'text' as const, value: await handleCommand(_args.trim()) }
      },
    }
  },
}

async function handleCommand(args: string): Promise<string> {
  const subcommand = args.split(/\s+/)[0]?.toLowerCase()

  switch (subcommand) {
    case 'hatch':
    case 'adopt':
      return handleHatch()
    case 'mute':
    case 'silence':
      return handleMute()
    case 'unmute':
    case 'unsilence':
      return handleUnmute()
    case 'info':
    case 'stats':
      return handleInfo()
    default:
      return handleShow()
  }
}

function handleShow(): string {
  const companion = getCompanion()
  if (!companion) {
    return 'You don\'t have a companion yet. Use `/buddy hatch` to adopt one!'
  }
  return formatCompanion(companion)
}

function handleHatch(): string {
  const existing = getGlobalConfig().companion
  if (existing) {
    return `You already have a companion! Use \`/buddy info\` to see it. To re-hatch, use \`/buddy hatch --force\`.`
  }

  const userId = companionUserId()
  const { bones } = roll(userId)
  const newCompanion = {
    ...bones,
    name: 'Buddy',
    personality: 'Friendly and curious',
    hatchedAt: Date.now(),
  }
  saveGlobalConfig({ companion: newCompanion } as any)
  return `🎉 A new companion has hatched!\n\n${formatCompanion(newCompanion)}`
}

function handleInfo(): string {
  const companion = getCompanion()
  if (!companion) {
    return 'No companion. Use `/buddy hatch` to adopt one!'
  }
  return formatCompanion(companion, true)
}

function handleMute(): string {
  saveGlobalConfig({ companionMuted: true } as any)
  return 'Companion has been muted.'
}

function handleUnmute(): string {
  saveGlobalConfig({ companionMuted: false } as any)
  return 'Companion has been unmuted.'
}

function formatCompanion(
  companion: Companion,
  detailed = false,
): string {
  const stars = RARITY_STARS[companion.rarity]
  const color = RARITY_COLORS[companion.rarity]

  let output = `**${companion.name}** ${stars} (${companion.rarity})\n`
  output += `Species: ${companion.species} | Eyes: ${companion.eye} | Hat: ${companion.hat}`
  if (companion.shiny) output += ' ✨ SHINY'
  output += '\n'

  if (detailed && companion.personality) {
    output += `\n_Personality_: ${companion.personality}\n`
    output += '\n**Stats**:\n'
    for (const [stat, value] of Object.entries(companion.stats)) {
      const bar = '█'.repeat(Math.floor(value / 10)) + '░'.repeat(10 - Math.floor(value / 10))
      output += `  ${stat.padEnd(12)} ${bar} ${value}/100\n`
    }
  }

  return output
}

export default command