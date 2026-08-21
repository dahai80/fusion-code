import { getFigures } from '../constants/figures.js'
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  modelSupportsEffort,
} from '../utils/effort.js'

/**
 * Build the text for the effort-changed notification, e.g. "◐ medium · /effort".
 * Returns undefined if the model doesn't support effort.
 */
export function getEffortNotificationText(
  effortValue: EffortValue | undefined,
  model: string,
): string | undefined {
  if (!modelSupportsEffort(model)) return undefined
  const level = getDisplayedEffortLevel(model, effortValue)
  return `${effortLevelToSymbol(level)} ${level} · /effort`
}

export function effortLevelToSymbol(level: EffortLevel): string {
  const fig = getFigures()
  switch (level) {
    case 'low':
      return fig.EFFORT_LOW
    case 'medium':
      return fig.EFFORT_MEDIUM
    case 'high':
      return fig.EFFORT_HIGH
    case 'max':
      return fig.EFFORT_MAX
    default:
      // Defensive: level can originate from remote config. If an unknown
      // value slips through, render the high symbol rather than undefined.
      return fig.EFFORT_HIGH
  }
}
