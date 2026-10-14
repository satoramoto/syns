/**
 * The instrument's colours. Each hue means one thing, everywhere:
 *
 * - grey (MUTED): labels, icons, git marks, ordinary values
 * - slate (INK): "how much" — bars and gauges that only measure
 * - blue: live or in progress — running, pending, the activity series
 * - amber: getting close to a limit — 75% and up, the compaction mark
 * - red: failed, conflicted, 90% and up
 * - green: finished well — checks passed, an agent done
 * - purple: merged
 *
 * Cyan and orchid aren't statuses: they only tint parts within one chart.
 */
export const C = {
  ok: '#5bc08a',
  warn: '#e3a33b',
  bad: '#e5636f',
  blue: '#6c8ef5',
  purple: '#9d85e8',
  cyan: '#4fb3c8',
  slate: '#8c9bb5',
  orchid: '#c58ad6',
} as const

/** Quantity ink: what a bar or gauge is drawn in when it only says how much. */
export const INK = C.slate

/** Shades within one chart: parts of one thing, told apart without new meanings. */
export const RAMP = {
  blue: ['#6c8ef5', '#4c68c9', '#a9bbf9', '#38509e'],
  slate: ['#8c9bb5', '#6f7c93', '#a7b2c6', '#5b667a'],
} as const

/** A bar's empty part and other quiet fills: a grey that reads on light and dark. */
export const TRACK = 'rgba(128,128,128,0.18)'

/**
 * `color` (#rgb or #rrggbb) at `alpha` (0 to 1), as rgba(): a tint that lets the
 * pane show through, so it reads on the light desktop theme and the dark one.
 * Undefined for anything that isn't a hex colour.
 */
export const tint = (color: string, alpha: number): string | undefined => {
  const hex = color.replace(/^#/, '')
  const full = hex.length === 3 ? [...hex].map(x => x + x).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return undefined
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * The app surfaces' fills, behind text. The engine gives render hooks no desktop
 * theme to read and no theme key for a fill, so each is a see-through tint over
 * the pane: a neutral grey darkens the light pane and lightens the dark one by
 * about the same step, and the text over it keeps the theme's own foreground.
 * Never on the terminal, which draws no fills.
 *
 * - head: a section header's band, the step that marks where a section starts;
 * - tile: one item of a list of several-line items, a step quieter than a band;
 * - selected: the picked tile or row, tinted towards the blue that means live;
 * - selectedBlurred: the same while the pane doesn't have the keyboard, half as strong;
 * - pill: how strongly a label's own colour fills its chip.
 */
export const FILL = {
  head: 'rgba(128,128,128,0.09)',
  tile: 'rgba(128,128,128,0.05)',
  selected: tint(C.blue, 0.13)!,
  selectedBlurred: tint(C.blue, 0.065)!,
  pill: 0.22,
} as const

/** Text, icons and marks that should recede. */
export const MUTED = '#8e8e93'

/**
 * Three greys for text below the main text, each a step quieter, so a row can say
 * what matters most without colour (tuned for the desktop's dark pane; mid and
 * dark also read on the light one):
 * - light: secondary text a reader still reads (a linked PR's title, a byline);
 * - mid: metadata scanned past (ages, counts, secondary actions);
 * - dark: the quietest marks (an icon beside a count, a heading over a list).
 */
export const GRAY = { light: '#b9b9b6', mid: '#8a8a87', dark: '#62625f' } as const

/** A colour with one value for the light desktop theme and one for the dark. */
export type Duo = { readonly light: string; readonly dark: string }

/**
 * File-type icon colours. One meaning: this file's type. Only a file tree's icons
 * take them, never text, a header or a control (those stay grey), and only on the
 * app surfaces: the terminal draws file icons monochrome (dim), as a file type is
 * no state a theme key means.
 *
 * The values are IntelliJ's New UI ("expui") icon colours, each from the fill or
 * stroke of the icon named beside it: intellij-community
 * `platform/icons/src/expui/fileTypes/<name>.svg` (light) and `<name>_dark.svg`
 * (dark), and `platform/icons/src/expui/nodes/` for the folders. Apache 2.0,
 * © JetBrains s.r.o. and contributors (each SVG's header).
 *
 * An icon drawn in a Duo carries both values and picks one by the page's colour
 * scheme (`iconSvg` in kit/icons.ts); where that can't be read it takes the dark.
 */
export const FILE_TYPE = {
  /** typeScript.svg */
  typescript: { light: '#3574F0', dark: '#548AF7' },
  /** javaScript.svg */
  javascript: { light: '#FFAF0F', dark: '#F2C55C' },
  /** json.svg */
  json: { light: '#834DF0', dark: '#B589EC' },
  /** markdown.svg */
  markdown: { light: '#3574F0', dark: '#548AF7' },
  /** config.svg (its accent), toml.svg, docker.svg */
  config: { light: '#3574F0', dark: '#548AF7' },
  /** yaml.svg */
  yaml: { light: '#DB3B4B', dark: '#DB5C5C' },
  /** css.svg */
  style: { light: '#4682FA', dark: '#548AF7' },
  /** html.svg */
  html: { light: '#369650', dark: '#57965C' },
  /** xml.svg */
  xml: { light: '#E66D17', dark: '#C77D55' },
  /** csv.svg */
  data: { light: '#208A3C', dark: '#57965C' },
  /** sql.svg */
  sql: { light: '#834DF0', dark: '#B589EC' },
  /** image.svg */
  image: { light: '#3574F0', dark: '#548AF7' },
  /** archive.svg */
  archive: { light: '#3574F0', dark: '#548AF7' },
  /** text.svg, shell.svg, unknown.svg, font.svg: any other file, lockfiles included */
  text: { light: '#6C707E', dark: '#CED0D6' },
  /** nodes/folder.svg, nodes/folderGithub.svg */
  folder: { light: '#6C707E', dark: '#CED0D6' },
  /** nodes/excludeRoot.svg: a folder git ignores (node_modules, build output) */
  excluded: { light: '#F28C35', dark: '#C77D55' },
} as const satisfies Record<string, Duo>

export type FileType = keyof typeof FILE_TYPE

/** Slate under 75%, amber from 75%, red from 90%: colour only once it matters. */
export const levelColor = (percent: number): string => (percent >= 90 ? C.bad : percent >= 75 ? C.warn : INK)

/*
 * The terminal's colours. The terminal draws each status in the engine theme key
 * that means the same thing, so it follows the person's terminal theme (dark,
 * light, colour-blind, ANSI-only) instead of a fixed hex that may not read on it:
 *
 * - green  C.ok     → 'success'
 * - red    C.bad    → 'error'
 * - amber  C.warn   → 'warning'
 * - blue   C.blue   → 'suggestion'
 * - purple C.purple → 'merged'
 * - the greys (MUTED, GRAY, TRACK) → the terminal's own dim, never a grey hex
 * - quantity (INK, slate) → the terminal's default foreground
 * - the shades within one chart (RAMP, cyan, orchid) → plain and dim in turn
 *   (TERM_TINT), the blue ramp as `suggestion` and dimmed `suggestion`
 * - any other hex → the default foreground: no fixed hex reaches the terminal,
 *   where it can vanish on a light, an ANSI-only or a colour-blind theme.
 */
export const THEME_KEY: Readonly<Record<string, string>> = {
  [C.ok]: 'success',
  [C.bad]: 'error',
  [C.warn]: 'warning',
  [C.blue]: 'suggestion',
  [C.purple]: 'merged',
}

const QUIET = new Set<string>([MUTED, GRAY.light, GRAY.mid, GRAY.dark, TRACK])

/** Text props on the terminal: a theme key, the terminal's dim, or neither (the default foreground). */
export type TermInk = { color?: string; dimColor?: boolean }

/**
 * The chart shades on the terminal, which has no colours to spare for them: the
 * slate ramp (quantity) is the default foreground and dim in turn, the blue ramp
 * `suggestion` and dimmed `suggestion` in turn, cyan plain and orchid dim. Parts
 * next to each other in a bar also differ by glyph (`█`, `▓`), so they read
 * without colour too.
 */
export const TERM_TINT: Readonly<Record<string, TermInk>> = {
  [RAMP.slate[0]]: {},
  [RAMP.slate[1]]: { dimColor: true },
  [RAMP.slate[2]]: {},
  [RAMP.slate[3]]: { dimColor: true },
  [RAMP.blue[1]]: { color: 'suggestion', dimColor: true },
  [RAMP.blue[2]]: { color: 'suggestion' },
  [RAMP.blue[3]]: { color: 'suggestion', dimColor: true },
  [C.cyan]: {},
  [C.orchid]: { dimColor: true },
}

/** Whether `color` is one of the kit's tokens (a status, a grey, a chart shade), not data such as a GitHub label's hex. */
export const isKitColor = (color: string): boolean => QUIET.has(color) || color in THEME_KEY || color in TERM_TINT

/** A raw colour (hex, rgb(), hsl()) rather than a theme key's name. */
const RAW = /^(#|rgba?\(|hsla?\()/i

/**
 * A colour's Text props on the terminal: a status as its theme key, a grey as
 * `dimColor`, a chart shade as TERM_TINT says, a theme key's name as itself, and
 * any other raw colour as nothing (the default foreground). Nothing for no colour.
 */
export const termInk = (color?: string): TermInk => {
  if (!color) return {}
  if (QUIET.has(color)) return { dimColor: true }
  const key = THEME_KEY[color]
  if (key) return { color: key }
  const tint = TERM_TINT[color]
  if (tint) return { ...tint }
  return RAW.test(color) ? {} : { color }
}

/**
 * One glyph per idea, shared so mods read alike (the SVG icons are keyed by these).
 * Each is what the terminal draws: one cell, and never a character with an emoji
 * presentation (Unicode's Emoji property: ⚒ ⚠ ⚡ ⏱ ↕ ◼ draw as emoji in some
 * terminals and take two cells).
 */
export const GLYPH = {
  context: '◕',
  cost: '$',
  time: '◷',
  turns: '↻',
  // The place-of-interest sign, as on a Command key: what the tools are called with.
  tools: '⌘',
  files: '✎',
  agents: '✦',
  limits: '◔',
  layers: '▤',
  branch: '⎇',
  pr: '⇡',
  running: '◐',
  done: '✓',
  failed: '✕',
  stopped: '■',
  pending: '◌',
  up: '↑',
  down: '↓',
} as const

/**
 * A status's mark: one glyph and the colour that means it, the same on every
 * surface. Draw it with `k.status(kind)`, never by hand, so a running task, a
 * running server and a pending check all read alike.
 */
export const STATUS = {
  running: { glyph: GLYPH.running, color: C.blue },
  pending: { glyph: GLYPH.pending, color: C.blue },
  done: { glyph: GLYPH.done, color: C.ok },
  failed: { glyph: GLYPH.failed, color: C.bad },
  warn: { glyph: '▲', color: C.warn },
  merged: { glyph: '◆', color: C.purple },
  stopped: { glyph: GLYPH.stopped, color: MUTED },
  idle: { glyph: '○', color: MUTED },
} as const

export type StatusKind = keyof typeof STATUS

/**
 * Tree connectors for nested rows (agents under the agent that spawned them,
 * files under folders), each two cells wide so levels indent on the grid.
 */
export const TREE = { tee: '├─', last: '└─', pipe: '│ ', blank: '  ' } as const

/**
 * A nested row's connector: for each level above it, a pipe where that level has
 * more rows below, else blank; then a tee, or an elbow for the last child.
 * Empty at the top level.
 */
export const treePrefix = (guides: boolean[], last: boolean, depth = guides.length + 1): string =>
  depth === 0 ? '' : `${guides.map(g => (g ? TREE.pipe : TREE.blank)).join('')}${last ? TREE.last : TREE.tee}`
