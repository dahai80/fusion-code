import { createRequire } from 'node:module'
import { env } from '../utils/env.js'

// NOTE: getInitialSettings is intentionally NOT imported at module top level.
// figures.ts is imported by PermissionMode.ts (PAUSE_ICON), and settings.js
// transitively imports PermissionMode via settings/types.ts. A top-level
// settings import creates a cycle: figures → settings → settings/types →
// PermissionMode → figures (PAUSE_ICON before initialization = TDZ).
// getFigures() resolves settings lazily on first call (render time, after all
// modules are initialized), breaking the cycle.
const lazyRequire = createRequire(import.meta.url)

// The former is better vertically aligned, but isn't usually supported on Windows/Linux
export const BLACK_CIRCLE = env.platform === 'darwin' ? '⏺' : '●'
export const BULLET_OPERATOR = '∙'
export const TEARDROP_ASTERISK = '✻'
export const UP_ARROW = '\u2191' // ↑ - used for opus 1m merge notice
export const DOWN_ARROW = '\u2193' // ↓ - used for scroll hint
export const LIGHTNING_BOLT = '↯' // \u21af - used for fast mode indicator
export const EFFORT_LOW = '○' // \u25cb - effort level: low
export const EFFORT_MEDIUM = '◐' // \u25d0 - effort level: medium
export const EFFORT_HIGH = '●' // \u25cf - effort level: high
export const EFFORT_MAX = '◉' // \u25c9 - effort level: max (Opus 4.6 only)

// Media/trigger status indicators
export const PLAY_ICON = '\u25b6' // ▶
export const PAUSE_ICON = '\u23f8' // ⏸

// MCP subscription indicators
export const REFRESH_ARROW = '\u21bb' // ↻ - used for resource update indicator
export const CHANNEL_ARROW = '\u2190' // ← - inbound channel message indicator
export const INJECTED_ARROW = '\u2192' // → - cross-session injected message indicator
export const FORK_GLYPH = '\u2442' // ⑂ - fork directive indicator

// Review status indicators (ultrareview diamond states)
export const DIAMOND_OPEN = '\u25c7' // ◇ - running
export const DIAMOND_FILLED = '\u25c6' // ◆ - completed/failed
export const REFERENCE_MARK = '\u203b' // ※ - komejirushi, away-summary recap marker

// Issue flag indicator
export const FLAG_ICON = '\u2691' // ⚑ - used for issue flag banner

// Blockquote indicator
export const BLOCKQUOTE_BAR = '\u258e' // ▎ - left one-quarter block, used as blockquote line prefix
export const HEAVY_HORIZONTAL = '\u2501' // ━ - heavy box-drawing horizontal

// Bridge status indicators
export const BRIDGE_SPINNER_FRAMES = [
  '\u00b7|\u00b7',
  '\u00b7/\u00b7',
  '\u00b7\u2014\u00b7',
  '\u00b7\\\u00b7',
]
export const BRIDGE_READY_INDICATOR = '\u00b7\u2714\ufe0e\u00b7'
export const BRIDGE_FAILED_INDICATOR = '\u00d7'

// screen-reader figure set: when prefersReducedMotion is active, return ASCII
// downgrades for the Unicode symbols above so screen readers read plain text.
// Existing `export const` constants are kept byte-identical for consumers that
// have not migrated to getFigures() \u2014 default-off behavior is unchanged.
// Lazy: first call reads settings at render time (well after module load),
// cached keyed on the reducedMotion boolean so it recomputes on change.
export type FigureSet = Readonly<{
  BLACK_CIRCLE: string
  BULLET_OPERATOR: string
  TEARDROP_ASTERISK: string
  UP_ARROW: string
  DOWN_ARROW: string
  LIGHTNING_BOLT: string
  EFFORT_LOW: string
  EFFORT_MEDIUM: string
  EFFORT_HIGH: string
  EFFORT_MAX: string
  PLAY_ICON: string
  PAUSE_ICON: string
  REFRESH_ARROW: string
  CHANNEL_ARROW: string
  INJECTED_ARROW: string
  FORK_GLYPH: string
  DIAMOND_OPEN: string
  DIAMOND_FILLED: string
  REFERENCE_MARK: string
  FLAG_ICON: string
  BLOCKQUOTE_BAR: string
  HEAVY_HORIZONTAL: string
  BRIDGE_SPINNER_FRAMES: readonly string[]
  BRIDGE_READY_INDICATOR: string
  BRIDGE_FAILED_INDICATOR: string
}>

const UNICODE_SET: FigureSet = Object.freeze({
  BLACK_CIRCLE,
  BULLET_OPERATOR,
  TEARDROP_ASTERISK,
  UP_ARROW,
  DOWN_ARROW,
  LIGHTNING_BOLT,
  EFFORT_LOW,
  EFFORT_MEDIUM,
  EFFORT_HIGH,
  EFFORT_MAX,
  PLAY_ICON,
  PAUSE_ICON,
  REFRESH_ARROW,
  CHANNEL_ARROW,
  INJECTED_ARROW,
  FORK_GLYPH,
  DIAMOND_OPEN,
  DIAMOND_FILLED,
  REFERENCE_MARK,
  FLAG_ICON,
  BLOCKQUOTE_BAR,
  HEAVY_HORIZONTAL,
  BRIDGE_SPINNER_FRAMES,
  BRIDGE_READY_INDICATOR,
  BRIDGE_FAILED_INDICATOR,
})

const ASCII_SET: FigureSet = Object.freeze({
  BLACK_CIRCLE: '*',
  BULLET_OPERATOR: '-',
  TEARDROP_ASTERISK: '*',
  UP_ARROW: '^',
  DOWN_ARROW: 'v',
  LIGHTNING_BOLT: '>',
  EFFORT_LOW: 'o',
  EFFORT_MEDIUM: 'o',
  EFFORT_HIGH: '*',
  EFFORT_MAX: '*',
  PLAY_ICON: '>',
  PAUSE_ICON: '||',
  REFRESH_ARROW: 'R',
  CHANNEL_ARROW: '<-',
  INJECTED_ARROW: '->',
  FORK_GLYPH: 'F',
  DIAMOND_OPEN: 'o',
  DIAMOND_FILLED: '*',
  REFERENCE_MARK: '*',
  FLAG_ICON: '!',
  BLOCKQUOTE_BAR: '|',
  HEAVY_HORIZONTAL: '-',
  BRIDGE_SPINNER_FRAMES: Object.freeze(['-|-', '-/-', '---', '-\\-']),
  BRIDGE_READY_INDICATOR: '-OK-',
  BRIDGE_FAILED_INDICATOR: 'x',
})

let cachedFigures: FigureSet | null = null
let cachedFiguresReducedMotion: boolean | null = null

export function getFigures(): FigureSet {
  // Lazy settings resolution \u2014 breaks the figures\u2194settings\u2194PermissionMode
  // cycle (see top-of-file NOTE). Render-time only, after module init.
  const { getInitialSettings } = lazyRequire('../utils/settings/settings.js')
  const reducedMotion = getInitialSettings().prefersReducedMotion === true
  if (cachedFigures && cachedFiguresReducedMotion === reducedMotion) {
    return cachedFigures
  }
  cachedFigures = reducedMotion ? ASCII_SET : UNICODE_SET
  cachedFiguresReducedMotion = reducedMotion
  return cachedFigures
}
