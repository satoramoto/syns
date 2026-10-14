import type { RenderElement, RenderSurface } from 'claude-code'

import { middle, pct, short } from './format'
import { ICON_PX, glyphOf, iconSvg } from './icons'
import { ms } from './perf'
import type { PerfRow, PerfSnapshot } from './perf'
import { C, FILL, GLYPH, GRAY, INK, MUTED, STATUS, TRACK, isKitColor, termInk, tint, treePrefix } from './tokens'
import type { Duo, StatusKind } from './tokens'

/**
 * The shared components. Each draws for the surface it is given: on the app
 * surfaces (desktop, VS Code, mobile) as boxes laid out by flexbox, crisp at
 * any width; in the terminal as cells, `columns` wide.
 *
 * What the desktop accepts (2.1.293): whole percentages only, `flexGrow` up to
 * 10000, fractional heights and margins; no `hover`. Borders `round` (rounded
 * corners), single, double, bold and classic draw; `dashed` doesn't. SVG is
 * drawn as an image: crisp only at its exact pixel size, so it's kept to small
 * fixed pieces like bar ends.
 *
 * Units on the desktop (measured on 2.1.295): a column (widths, paddingX, marginX,
 * gaps between columns) is ~7.8px; a row of size (`height`, `minHeight`) is ~19px,
 * one text line; but vertical spacing (marginTop/Bottom/Y, paddingTop/Bottom/Y,
 * rowGap) is half that, ~9.5px a unit. A `transparent` border colour is drawn in
 * the text's colour, so the kit draws no border to round a fill.
 */

/** The element constructors the kit draws with. `Button` is needed only for collapsible sections. */
export type Els = {
  Box: (props: any, ...children: any[]) => RenderElement
  Text: (props: any, ...children: any[]) => RenderElement
  Button?: (props: any, ...children: any[]) => RenderElement
  /** Rounds the ends of bars where the surface has it. */
  Svg?: (props: any, ...children: any[]) => RenderElement
}

/**
 * The Buttons one pane drew last, per scope: each by its key, with the props and
 * children it was drawn with, the element built for them, and the latest press.
 */
type HeldButton = { look: string; made: unknown; element: RenderElement; frame: number; press: (e: any) => void }
const heldButtons = new Map<string, { frame: number; buttons: Map<string, HeldButton> }>()

/**
 * The element table `els` with a `Button` that keeps each button's press handle
 * from one drawing to the next, for the drawing `scope` names (the render event
 * itself: its component, requestId and surface). Call it once per render, as
 * the drawing starts (after the render's awaits), and draw every Button of that
 * render with the table it returns (the kit's own included: pass it to `kit`).
 *
 * Why: the engine's JSX gives every Button it builds a new handle, and frees the
 * old one as soon as a drawing leaves it out; a press reaches its `onPress` by
 * that handle alone. So a redraw between drawing and click (the click focusing
 * the pane, a timer's write) left the press on a freed handle, and it did
 * nothing. Here a Button whose key, props and children match the last render's
 * is that same element, its handle unchanged, its press running the latest
 * `onPress`. One that changed is built anew (a stale press on it misses, as it
 * should); one absent from the last render is forgotten.
 */
export const holdButtons = <E extends { Button?: unknown }>(els: E, scope: string | { component: string; requestId: string; surface: string }): E => {
  const Made = els.Button as ((props: any, ...children: any[]) => RenderElement) | undefined
  if (!Made) return els
  const id = typeof scope === 'string' ? scope : `${scope.component}\u0000${scope.requestId}\u0000${scope.surface}`
  const pane = heldButtons.get(id) ?? { frame: 0, buttons: new Map<string, HeldButton>() }
  heldButtons.set(id, pane)
  // A new render: keep only what the last one drew.
  for (const [key, b] of pane.buttons) if (b.frame < pane.frame) pane.buttons.delete(key)
  pane.frame += 1
  const frame = pane.frame
  const Button = (props: any, ...rest: any[]): RenderElement => {
    const { children: given, onPress, ...plain } = props ?? {}
    const children: unknown[] = rest.length ? rest : given === undefined ? [] : Array.isArray(given) ? given : [given]
    const key = plain.key ?? plain.label ?? (children.length === 1 && typeof children[0] === 'string' ? children[0] : undefined)
    if (typeof key !== 'string' || typeof onPress !== 'function') {
      return (
        <Made {...plain} onPress={onPress}>
          {children}
        </Made>
      )
    }
    const look = JSON.stringify([plain, children])
    const was = pane.buttons.get(key)
    // A second Button on one key in one render is built apart: one element can't hold two presses.
    if (was?.frame === frame) {
      return (
        <Made {...plain} onPress={onPress}>
          {children}
        </Made>
      )
    }
    // The same look from the same constructor (another plugin may restyle the table's).
    if (was && was.look === look && was.made === Made) {
      was.frame = frame
      was.press = onPress
      return was.element
    }
    const b: HeldButton = { look, made: Made, frame, press: onPress, element: null as unknown as RenderElement }
    b.element = (
      <Made {...plain} onPress={(e: any) => b.press(e)}>
        {children}
      </Made>
    )
    pane.buttons.set(key, b)
    return b.element
  }
  // Everything else read through to the table as it was (whatever kind of object it is).
  // Defined, not assigned: the engine's table is frozen, and its read-only Button would refuse an assignment.
  return Object.create(els, { Button: { value: Button, enumerable: true } }) as E
}

/**
 * A bar part: its value, its color, and the label its legend shows. `room: true`
 * marks room rather than use (free space, a reserve): the terminal draws it as
 * the bar's light rail in its colour, and a `bar: true` legend keys it with `─`.
 */
export type Part = { value: number; color: string; label?: string; room?: boolean }

const BAR = 0.45

/** One row's height in CSS pixels on the desktop, measured: a 0.45-row bar is 8.5px tall. */
const ROW_PX = 8.5 / 0.45
/** One column's width in CSS pixels on the desktop (as the playground calibrates it): what an SVG sized in cells is drawn at. */
const COL_PX = 7.8

/*
 * The grid. Mods use these, never raw spacing numbers:
 *
 * - SPACE.pair between the two halves of a pair (glyph and figure, dot and label),
 *   SPACE.item between items in a row, SPACE.group between groups of items;
 *   SPACE.block between blocks inside a section body (rows in a list sit at 0).
 * - INSET: a band's (header, footer) padding on both sides, and a body's on the right,
 *   so header figures, body figures and the footer end on one line.
 * - BODY_INDENT: a body's left edge, just past the header's fold arrow.
 * - Reading columns: LABEL | gauge (grows) | FIG right-aligned | FIG2 right-aligned.
 */
export const SPACE = { pair: 0.75, item: 1.25, group: 2, block: 0.8 } as const
const INSET = 1
const BODY_INDENT = 1.6
/**
 * The content edges: everything that isn't a band (the header totals, section bodies)
 * starts at `left` and ends at `right`. Alignment rules, for every row:
 * - labels, names and titles start on the left edge;
 * - the row's last figure or action ends on the right edge (rows are space-between);
 * - figures are right-aligned; a row's right side is one cluster, never two.
 */
export const EDGE = { left: BODY_INDENT, right: INSET } as const
const LABEL = 10
const FIG = 5
const FIG2 = 6
/** The terminal's fold-arrow gutter. */
const GUTTER = 2

/*
 * The terminal's grid. A terminal lays out in whole cells, so it has its own
 * spacing (a fraction would round differently row to row) and draws to an exact
 * width in cells. `k.space` and `k.edge` give the grid for the kit's surface.
 *
 * - CELLS: pair 1 (glyph and figure), item 1 (columns of a reading), group 2
 *   (figures in a summary, actions in a row), block 1 (a blank row).
 * - Indent: a section body starts GUTTER (2) in, under the header's icon column;
 *   each tree level indents 2 more.
 * - Reading columns: LABEL (10) | gauge (the rest) | FIG (5) | FIG2 (6), one cell
 *   apart; under MIN_GAUGE cells of gauge the label narrows, then the gauge goes.
 */
export const CELLS = { pair: 1, item: 1, group: 2, block: 1 } as const
/** The fewest cells a terminal gauge is drawn in; narrower, the reading drops it and keeps its figures. */
const MIN_GAUGE = 6
/** The narrowest a terminal reading's label gets before its gauge is dropped. */
const MIN_LABEL = 6
/** The cells of its text a terminal list item keeps (with its ellipsis) before its right cluster is cut. */
const ITEM_KEEPS = 6
/**
 * The narrowest pane the terminal draws section bodies in. Narrower, each section
 * draws its header and figures only (a floor, as bottom's basic mode), rather
 * than every reading collapsing to an ellipsis.
 */
export const MIN_COLUMNS = 30

/**
 * The terminal's meter glyphs. A gauge and a bar are both a heavy line on a light
 * one, to half a cell (╸): a bar's parts are runs of the heavy line, each in its
 * own solid theme colour, and its room (free space, a reserve) the light rail in
 * its colour. No shades or dithers: they render as a checkerboard in real fonts.
 */
export const METER = {
  line: '━',
  half: '╸',
  rail: '─',
  /** Lower eighths, 0 to 8: for columns that rise. */
  rise: [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
} as const

/**
 * The widest a dashboard's sections are drawn on the terminal, in cells, when a
 * mod passes `measure: MEASURE` to `kit()`: past it, more width only spreads
 * readings apart and sends the eye across the pane.
 */
export const MEASURE = 72
/** The terminal's right margin: figures stop one cell short of the pane's edge. */
const RIGHT = 1
/** The cells a section title's column takes, so header figures start on one column. */
const TITLE_COL = 10

/** The terminal's fold arrows: the small triangles, a cell each. */
export const FOLD = { open: '▾', closed: '▸' } as const

/**
 * The terminal's marks for lists and footers: a selected row's gutter mark (a
 * left half block, in `suggestion`, Claude Code's own selection colour), the key
 * hints' separator, and the ellipsis that ends anything cut.
 */
export const MARK = { selected: '▌', sep: ' · ', more: '…', stale: '↻' } as const

/**
 * Braille dots for a sparkline, filled from the bottom: a cell holds two points
 * (its left and right dot columns), four levels each. `left[n]` is the left
 * column's bottom n dots, `right[n]` the right column's; OR them onto U+2800.
 */
export const SPARK = {
  base: 0x2800,
  left: [0, 0x40, 0x44, 0x46, 0x47],
  right: [0, 0x80, 0xa0, 0xb0, 0xb8],
} as const
/**
 * A band's (a section header's, a footer's) height on the app surfaces, in rows of
 * size: one text row and a little room. Fixed rather than padded, so every band is
 * as tall as every other whatever it holds: a native Button, a Link or an icon in
 * a row of the real desktop is taller or shorter than a line of text, and a padded
 * band grew or shrank with it (the launcher's rows came out uneven).
 */
export const BAND_ROWS = 1.3

/**
 * A Braille blank (U+2800): drawn as nothing, as a space is, but never trimmed or
 * collapsed. A Button labelled with them lies over what the desktop can't draw in a
 * Button (an icon, a coloured word), which shows through; its key is its address.
 */
export const BLANK = '⠀'
/** A tile's padding above and below its lines, and the room between its lines: enough to breathe. */
const TILE_PAD_Y = 0.6
const TILE_ROW_GAP = 0.2

/**
 * The desktop's fold arrow: full-size triangles, since text can't be sized.
 * U+FE0E keeps ▶ a text glyph; without it macOS can draw it as an emoji. Never
 * on the terminal, which draws FOLD and never gets a variation selector.
 */
export const fold = (collapsed: boolean) => (collapsed ? '▶︎' : '▼')


/**
 * `text` split for two terminal lines `width` cells wide: the first holds as many
 * whole words as fit (a word longer than the line is cut to it), the second the
 * rest, which the caller truncates. The second is empty when it all fits on one.
 */
const breakLine = (text: string, width: number): [string, string] => {
  const chars = [...text]
  if (chars.length <= width) return [text, '']
  // The last space at or before the line's end; none, a hard cut.
  let cut = -1
  for (let i = Math.min(width, chars.length - 1); i > 0; i--) {
    if (chars[i] === ' ') {
      cut = i
      break
    }
  }
  if (cut <= 0) return [chars.slice(0, width).join(''), chars.slice(width).join('').trimStart()]
  return [chars.slice(0, cut).join('').trimEnd(), chars.slice(cut + 1).join('').trimStart()]
}


/** The debug footer's glyph for each job the mods time; all muted, a slow job's figure turns amber or red. */
export const PERF_GLYPH: Readonly<Record<string, string>> ={ render: '▣', tick: '↻', resources: '◎', usage: '◕', git: '⎇', gh: '⇡' }

/*
 * The terminal's look ("rules", after lazygit and gh-dash, made quieter). A header
 * is a dim arrow and icon, the title in bold default foreground, its figures on a
 * shared column right after it (so the eye doesn't cross the pane), then a dim `─`
 * rule out to the edge. Status colours keep their one meaning; nothing else is coloured.
 *
 * Two tones and one weight carry the hierarchy: dim for what a thing is (labels,
 * units, notes), the default foreground for what it says (values, list text),
 * bold for the title and the one figure that matters in each section (a header's
 * first figure). No italics: real terminal fonts draw them oddly, and some not at
 * all. Tune the look here, in one place:
 * - title: a section's name: bold;
 * - label: what a value is (a reading's, a prop's, a legend entry's label): dim;
 * - value: the figure or word that answers (a reading's figure, a prop's value): plain;
 * - strong: the one figure per section that matters (a header's first figure): bold;
 * - secondary: text a reader still reads, after the main text (a list row's note): dim;
 * - meta: what's scanned past (units, ages, counts in a list row): dim.
 *
 * The alternatives it was picked from (inspector, panel, ledger) are in commit ab3a37a.
 */

/** Text props a terminal role is drawn with. */
type Role = { color?: string; dimColor?: boolean; bold?: boolean; italic?: boolean }

export const TERM_ROLES: Readonly<Record<'title' | 'label' | 'value' | 'strong' | 'secondary' | 'meta', Role>> = {
  title: { bold: true },
  label: { dimColor: true },
  value: {},
  strong: { bold: true },
  secondary: { dimColor: true },
  meta: { dimColor: true },
}

/**
 * The header icon's colour on the terminal: dim, as the fold arrow. Orange is kept
 * to the bold title word: a one-cell orange glyph reads too close to an amber
 * status glyph (warn `▲`, ahead `↑`) in the row under it.
 */
const TERM_HEADER_ICON = MUTED

/** What the kit is told about the pane beyond its surface and width. */
export type KitOptions = {
  /**
   * Whether the pane has the keyboard: pass `e.props.isFocused`. Key hints show
   * only while it's true, and a selected list row is drawn dimmed while it's
   * false. Left out, the pane counts as focused.
   */
  focused?: boolean
  /**
   * The widest the terminal draws sections, in cells (`MEASURE` for a dashboard
   * of readings). Past it a section keeps this width and the rest of the pane
   * stays empty. Left out, sections span the pane (a file tree wants every cell).
   */
  measure?: number
  /**
   * The column view's switch, as the mod holds it in its own state (key
   * `columns`, default on): off, `flow` gives one stack at any width. With a
   * `toggle`, a wide desktop pane's footer (`perf`, `footer`) draws the quiet
   * action that flips it (see `flowToggle`).
   */
  flow?: FlowSwitch
}

/** The column view's switch: `on` as the mod's state holds it, `toggle` to flip it from a press. */
export type FlowSwitch = { on: boolean; toggle?: () => void }

/**
 * A part of a list row's right cluster that says when it gives way: at narrow
 * widths the part with the highest `drop` goes first (ties: the later one), then
 * the next, until the row fits; parts without one (rank 0) are never dropped,
 * only cut. `cells` is its width on the terminal when it's an element the kit
 * can't measure (a string measures itself).
 */
export type RightPart = { part: RenderElement | string; drop?: number; cells?: number }

/** One key hint: the key as the person types it, and what it does. */
export type Hint = { key: string; label: string }

const isRightPart = (x: RenderElement | string | RightPart): x is RightPart => typeof x === 'object' && x !== null && 'part' in x && !('type' in x)

/**
 * The cells a part draws in on the terminal, as far as the kit can tell: a
 * string's characters; a Text's text; a row Box's children and gaps; a plain
 * Button's label (and `1: ` before it with a hotkey). Undefined when it can't.
 */
const cellsOf = (x: unknown): number | undefined => {
  if (x == null || x === false) return 0
  if (typeof x === 'string' || typeof x === 'number') return [...String(x)].length
  if (Array.isArray(x)) {
    let n = 0
    for (const c of x) {
      const m = cellsOf(c)
      if (m === undefined) return undefined
      n += m
    }
    return n
  }
  if (typeof x !== 'object') return undefined
  const el = x as { type?: string; props?: Record<string, any>; children?: unknown[] }
  const p = el.props ?? {}
  const kids = el.children ?? (p.children as unknown[] | undefined) ?? []
  if (el.type === 'Text') return cellsOf(kids)
  if (el.type === 'Button') {
    const label = p.label === undefined ? cellsOf(kids) : [...String(p.label)].length
    if (label === undefined) return undefined
    return (p.plain ? label : label + 4) + (p.hotkey ? 3 : 0)
  }
  if (el.type === 'Box') {
    const list = (Array.isArray(kids) ? kids : [kids]).flat(Infinity as 1).filter(c => c != null && c !== false)
    const sizes = list.map(cellsOf)
    if (sizes.some(s => s === undefined)) return undefined
    const n = sizes as number[]
    if (p.flexDirection === 'column') return Math.max(0, ...n)
    const gap = Number(p.columnGap ?? p.gap ?? 0)
    return n.reduce((a, b) => a + b, 0) + gap * Math.max(0, n.length - 1)
  }
  return undefined
}

/*
 * Flow: a pane's sections in columns when the desktop gives it the width.
 *
 * The engine tells a render its pane's width (`e.props.bodyColumns`; on the desktop
 * the pane's width over its code font's advance), and draws again when it changes.
 * At a sidebar's width the sections stack as they always have; past two of
 * FLOW_MIN (plus the gutter) they split into two columns, past three into three.
 * The terminal always stacks: its panes dock beside the transcript and are narrow.
 */

/**
 * The narrowest a flow column gets, in the pane's reported columns: about the
 * widest a desktop sidebar is drawn (Storybook's 110), halved, so a section in a
 * column reads as it does in a roomy sidebar. Two columns from 82 (about 640px), three from 124 (about 970px).
 */
export const FLOW_MIN = 40
/** The most columns a flow splits into: more makes every section a sliver. */
export const FLOW_MAX = 3
/** The gutter between flow columns: a group's room, as between groups of items in a row. No rule or panel marks it. */
const FLOW_GAP = SPACE.group

/** How a flow is told to lay out; each defaults to the kit's FLOW_MIN, FLOW_MAX. */
export type FlowOptions = {
  /** The narrowest column, in reported columns. */
  min?: number
  /** The most columns. */
  max?: number
  /**
   * Each block's height in rows, where the caller knows better than the kit's
   * estimate (`undefined` entries are estimated). In the order the blocks are given.
   */
  rows?: (number | undefined)[]
  /**
   * The room between blocks in a column, in the desktop's vertical units, for
   * blocks that space themselves apart in one stack (a list's tiles, each with a
   * margin above all but the first): in columns they drop that margin and the
   * column spaces them, so every column's first block starts on one line.
   */
  gap?: number
  /** One stack at any width: the column view switched off (KitOptions' `flow`). */
  single?: boolean
}

/** Whether a pane `columns` across on `surface` is wide enough to split into flow columns at all. */
export const flowSplits = (surface: RenderSurface, columns: number, o: Pick<FlowOptions, 'min'> = {}) =>
  surface !== 'terminal' && Math.floor((Math.floor(columns) + FLOW_GAP) / ((o.min ?? FLOW_MIN) + FLOW_GAP)) >= 2

/**
 * How many columns a flow of `blocks` blocks takes at `columns` across on
 * `surface`, and each column's width in reported columns: 1 and the whole width
 * on the terminal, at a sidebar's width, with fewer than two blocks, or `single`.
 */
export const flowColumns = (surface: RenderSurface, columns: number, blocks: number, o: FlowOptions = {}) => {
  const min = o.min ?? FLOW_MIN
  const max = o.max ?? FLOW_MAX
  const fit = surface === 'terminal' || o.single ? 1 : Math.floor((Math.floor(columns) + FLOW_GAP) / (min + FLOW_GAP))
  const count = Math.max(1, Math.min(fit, max, blocks))
  return { count, width: count === 1 ? columns : Math.floor((columns - FLOW_GAP * (count - 1)) / count) }
}

/** A drawn element's own props and children, as the engine's JSX and Storybook's both build them. */
const partsOf = (x: any): { type?: string; p: Record<string, any>; kids: unknown[] } => {
  const p = (x?.props ?? {}) as Record<string, any>
  const given = x?.children ?? p.children ?? []
  return { type: x?.type, p, kids: (Array.isArray(given) ? given : [given]).flat(Infinity as 1).filter(c => c != null && c !== false) }
}

/**
 * About how many rows tall an element draws on the desktop: a Text or a Button a
 * row, a column Box its children stacked, a row Box its tallest child, a `height`
 * as given; vertical margins, padding and gaps at half a row a unit, as the
 * desktop draws them. Only good enough to balance columns, never to size them.
 */
export const rowsOf = (x: unknown): number => {
  if (x == null || x === false) return 0
  if (typeof x === 'string' || typeof x === 'number') return 1
  if (Array.isArray(x)) return x.reduce((n: number, c) => n + rowsOf(c), 0)
  if (typeof x !== 'object') return 0
  const { type, p, kids } = partsOf(x)
  if (p.display === 'none' || p.position === 'absolute') return 0
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  // Vertical spacing in half rows (the desktop's unit for it), as rows.
  const around =
    (num(p.marginTop) + num(p.marginBottom) + 2 * num(p.marginY) + 2 * num(p.margin) + num(p.paddingTop) + num(p.paddingBottom) + 2 * num(p.paddingY) + 2 * num(p.padding)) / 2
  let own: number
  if (typeof p.height === 'number') own = p.height
  else if (type === 'Box') {
    const sizes = kids.map(rowsOf)
    if (p.flexDirection === 'column') own = sizes.reduce((a, b) => a + b, 0) + (num(p.rowGap ?? p.gap) * Math.max(0, sizes.length - 1)) / 2
    else own = Math.max(0, ...sizes)
  } else own = 1
  return Math.max(own, num(p.minHeight)) + around
}

/**
 * Splits `heights` into `n` runs in order, so the tallest run is as short as it
 * can be: blocks read top to bottom, then left to right, and the columns end
 * about even. Returns each run's first index.
 */
const balance = (heights: number[], n: number): number[] => {
  const m = heights.length
  const sum = [0]
  for (const h of heights) sum.push(sum[sum.length - 1]! + h)
  // best[j][i]: the tallest column laying the first i blocks in j columns; cut[j][i] where the last column starts.
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity))
  const cut = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  best[0]![0] = 0
  for (let j = 1; j <= n; j++) {
    for (let i = j; i <= m; i++) {
      // Every column holds at least one block.
      for (let s = j - 1; s < i; s++) {
        const tall = Math.max(best[j - 1]![s]!, sum[i]! - sum[s]!)
        // Ties go to the later cut, so earlier columns take more and the last isn't the tall one.
        if (tall <= best[j]![i]!) {
          best[j]![i] = tall
          cut[j]![i] = s
        }
      }
    }
  }
  const starts: number[] = []
  let i = m
  for (let j = n; j >= 1; j--) {
    starts.unshift(cut[j]![i]!)
    i = cut[j]![i]!
  }
  return starts
}

/**
 * Lays `blocks` (a pane's sections, a list's tiles) out in columns when the pane
 * is wide enough (see `flowColumns`); otherwise gives them back as they were, so
 * a narrow pane draws exactly what it drew before. Spread the result where the
 * blocks went: `{flow(Box, e.surface, columns, 'sections', [a, b, c])}`.
 *
 * A block is never split across columns. They read top to bottom, then left to
 * right, cut where the columns come out most even by `rowsOf`'s estimate (or the
 * `rows` given). Each column is a plain column Box (key `<key>-col-<n>`), each
 * block in it spanning the column's width; the gutter between is FLOW_GAP, with
 * no rule, panel or outline.
 */
export const flow = (
  Box: Els['Box'],
  surface: RenderSurface,
  columns: number,
  key: string,
  blocks: (RenderElement | null | false | undefined)[],
  o: FlowOptions = {},
): (RenderElement | null)[] => {
  const shown = blocks.map((b, i) => ({ b, rows: o.rows?.[i] })).filter((x): x is { b: RenderElement; rows: number | undefined } => x.b != null && x.b !== false)
  const { count } = flowColumns(surface, columns, shown.length, o)
  if (count < 2) return blocks.map(b => b || null)
  const starts = balance(
    shown.map(x => x.rows ?? rowsOf(x.b)),
    count,
  )
  const runs = starts.map((s, c) => shown.slice(s, starts[c + 1] ?? shown.length))
  return [
    <Box key={key} flexDirection="row" width="100%" columnGap={FLOW_GAP} alignItems="flex-start">
      {runs.map((run, c) => (
        // Columns share the row equally, growing from no width, as a legend's do (the desktop doesn't stretch a nested box).
        <Box key={`${key}-col-${c}`} flexDirection="column" flexGrow={1} flexShrink={1} width={0} minWidth={0} {...(o.gap ? { rowGap: o.gap } : {})}>
          {run.map((x, i) => (
            <Box key={`${key}-${c}-${i}`} flexDirection="column" width="100%" minWidth={0}>
              {x.b}
            </Box>
          ))}
        </Box>
      ))}
    </Box>,
  ]
}

export const kit = (els: Els, surface: RenderSurface, columns = 40, opts: KitOptions = {}) => {
  const { Box, Text, Button, Svg } = els
  const terminal = surface === 'terminal'
  /** Whether the pane has the keyboard; unknown counts as yes. */
  const paneFocused = opts.focused !== false
  /** A flow's options with the column view's switch applied: off, one stack. */
  const flowOpts = (o: FlowOptions = {}): FlowOptions => (opts.flow?.on === false ? { ...o, single: true } : o)
  /** Under MIN_COLUMNS the terminal draws section headers only. */
  const floor = terminal && Math.floor(columns) < MIN_COLUMNS
  /** A text role's props on the terminal (see TERM_ROLES). */
  const R = TERM_ROLES
  /** Text a step below the main text: one of the three greys on the app surfaces; plain dim in the terminal, whose greys are its own. */
  const tone = (level: keyof typeof GRAY) => (terminal ? { dimColor: true } : { color: GRAY[level] })
  /** A token colour as Text props for this surface: on the terminal a status's theme key, a grey as dim. */
  const ink = (color?: string): { color?: string; dimColor?: boolean } => (terminal ? termInk(color) : color ? { color } : {})
  /** The grid for this surface: CELLS on the terminal, SPACE elsewhere. */
  const space = terminal ? CELLS : SPACE
  const edge = terminal ? { left: GUTTER, right: RIGHT } : EDGE
  /** A section's width in terminal cells: the pane's, up to the measure. */
  const span = Math.max(1, Math.min(Math.floor(columns), opts.measure ?? Infinity))
  /** A section body's width in terminal cells: the section's less the gutter and the right margin. */
  const body = Math.max(1, span - GUTTER - RIGHT)
  const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)

  /** A run of one glyph in one colour, as one Text. */
  const run = (key: string, glyph: string, n: number, props: Record<string, unknown>) =>
    n > 0 ? <Text key={key} {...props}>{glyph.repeat(n)}</Text> : null

  /**
   * A terminal gauge `width` cells wide: a heavy line to the half cell over a
   * dim light rail. Anything above zero shows at least half a cell.
   */
  const lineMeter = (fraction: number, color: string, width: number): RenderElement => {
    const w = Math.max(1, Math.floor(width))
    let halves = Math.round(clamp01(fraction) * w * 2)
    if (fraction > 0 && halves === 0) halves = 1
    const full = Math.floor(halves / 2)
    const half = halves % 2
    return (
      <Text>
        {run('fill', METER.line, full, ink(color))}
        {half ? <Text key="half" {...ink(color)}>{METER.half}</Text> : null}
        {run('rail', METER.rail, w - full - half, { dimColor: true })}
      </Text>
    )
  }

  /**
   * A terminal bar `width` cells wide, one row: each part a run of the heavy line
   * (`━`) in its own solid colour, to the half cell; a `room` part the light rail
   * (`─`) in its colour; what's left the dim rail. Anything above zero shows at
   * least half a cell. A cell shared by two parts takes the first one's colour.
   */
  const lineBar = (parts: Part[], total: number, width: number): RenderElement => {
    const w = Math.max(1, Math.floor(width))
    const halves = w * 2
    const ends: { end: number; color: string; room: boolean }[] = []
    let at = 0
    for (const p of parts) {
      if (!(p.value > 0) || at >= halves) continue
      at = Math.min(halves, at + Math.max(1, Math.round((p.value / total) * halves)))
      ends.push({ end: at, color: p.color, room: Boolean(p.room) })
    }
    const partAt = (h: number) => ends.find(x => h < x.end)
    const rail = { glyph: METER.rail, props: { dimColor: true } as Record<string, unknown> }
    const cells: { glyph: string; props: Record<string, unknown> }[] = []
    for (let c = 0; c < w; c++) {
      const left = partAt(2 * c)
      const right = partAt(2 * c + 1)
      if (!left) cells.push(rail)
      else if (left.room) cells.push({ glyph: METER.rail, props: ink(left.color) })
      // A used part ending at the half: the half line, then nothing (a room part, or the rail, starts next cell).
      else if (!right || right.room) cells.push({ glyph: METER.half, props: ink(left.color) })
      else cells.push({ glyph: METER.line, props: ink(left.color) })
    }
    // Runs of the same glyph and colour, as one Text each.
    const runs: RenderElement[] = []
    let i = 0
    while (i < cells.length) {
      let j = i + 1
      while (j < cells.length && cells[j]!.glyph === cells[i]!.glyph && JSON.stringify(cells[j]!.props) === JSON.stringify(cells[i]!.props)) j++
      runs.push(<Text key={`r${i}`} {...cells[i]!.props}>{cells[i]!.glyph.repeat(j - i)}</Text>)
      i = j
    }
    return <Text>{runs}</Text>
  }

  /*
   * Rounding on the desktop. Boxes have no corner radius; what rounds is:
   *
   * - `capped`: anything thin (bars, gauges). SVG end caps drawn at an exact pixel
   *   size, so they stay crisp; the middle takes no height and stretches to the caps.
   * - Nothing else: `rounded` boxes (bands, tiles) are square-cornered fills.
   *
   * What doesn't work, so nobody tries again: a `round` border in `transparent` to
   * round a fill (the desktop doesn't know `transparent` as a border colour and draws
   * the border in the text's colour: every band and tile became an outlined bubble),
   * a border in a see-through fill's own colour (paints twice and draws a ring),
   * borders on thin bars (empty, or blobs),
   * glyph ends (◖━◗, ╺━╸ don't draw), SVG slivers a few pixels wide (don't draw), an
   * SVG stretched to fit (blurs), a circle drawn over a rect in one SVG (a translucent
   * colour doubles where they overlap).
   */

  /**
   * An icon at the kit's one size (ICON_PX square): the SVG drawing where the
   * surface has SVG and the kit has one for `key`, else its glyph as text
   * (`glyphOf`: the terminal glyph for a named icon, never the name itself).
   *
   * `color` may be a file type's `Duo` (`FILE_TYPE`): light and dark values on the
   * app surfaces, dim on the terminal, which draws file types monochrome.
   * `alt` names the drawing for a reader that can't see it (the desktop's
   * accessible name); `tooltip` also shows it under the pointer, drawing the SVG
   * interactive (a sandboxed frame), so keep it to an icon that says something
   * on its own (a branch's upstream), never one under a Button.
   */
  const icon = (key: string, color: string | Duo, px = ICON_PX, opts: { alt?: string; tooltip?: string } = {}): RenderElement => {
    const source = Svg && !terminal ? iconSvg(key, color, px, opts.tooltip) : null
    if (!Svg || !source) return <Text {...ink(typeof color === 'string' ? color : MUTED)}>{glyphOf(key)}</Text>
    const alt = opts.alt ?? opts.tooltip ?? 'icon'
    return opts.tooltip ? <Svg source={source} alt={alt} width={px} height={px} isInteractive /> : <Svg source={source} alt={alt} width={px} height={px} />
  }

  /**
   * One rounded end:a square `px` tall, a half circle on the outside and a filled
   * strip on the inside, as one shape.
   */
  const cap = (px: number, color: string, side: 'left' | 'right'): RenderElement | null => {
    if (!Svg) return null
    const r = px / 2
    const d = side === 'left' ? `M${r} 0H${px}V${px}H${r}A${r} ${r} 0 0 1 ${r} 0Z` : `M0 0H${r}A${r} ${r} 0 0 1 ${r} ${px}H0Z`
    // Over the track, as the bar's middle paints its parts: a see-through part's end
    // then comes out the same shade as the rest of it.
    const under = color === TRACK ? '' : `<path d="${d}" fill="${TRACK}"/>`
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
      `${under}<path d="${d}" fill="${color}"/></svg>`
    return (
      <Box flexShrink={0}>
        <Svg source={source} alt="rounded end" width={px} height={px} />
      </Box>
    )
  }

  /**
   * Rounds the ends of something thin: `middle` between a `left` and a `right` cap,
   * `height` rows tall. Give `middle` no height of its own; it stretches to the caps,
   * whose pixel size it can't drift from. Where the surface has no SVG, `middle` alone
   * at `height`.
   */
  const capped = (height: number, left: string, right: string, middle: (height: number | undefined) => RenderElement): RenderElement => {
    if (terminal || !Svg) return middle(height)
    const px = Math.max(4, Math.round(height * ROW_PX))
    return (
      <Box flexDirection="row" flexGrow={1} alignItems="stretch">
        {cap(px, left, 'left')}
        {middle(undefined)}
        {cap(px, right, 'right')}
      </Box>
    )
  }

  /**
   * A filled box, a row or more tall: a band or a tile. Square-cornered and with no
   * border on the app surfaces, as the design has no outlines and the desktop has no
   * transparent border to round a fill with (see "Rounding on the desktop" above).
   * In the terminal, the box without fill.
   */
  const rounded = (color: string, props: Record<string, unknown>, children: RenderElement | (RenderElement | null)[] | null) =>
    terminal ? (
      <Box {...props}>{children}</Box>
    ) : (
      <Box {...props} backgroundColor={color}>
        {children}
      </Box>
    )

  /**
   * A tile: one item of a list that has several lines (a branch and its PR), in its
   * own rounded fill a step lighter than the pane, so items read as units. A
   * `selected` tile takes a blue-tinted fill: picked, without an outline; half
   * as tinted while the pane isn't `focused` (the kit's `focused` by default).
   * On the terminal, a blank row above and no fill, selected or not: a terminal
   * list that selects draws its rows with `item`, which has a selection mark.
   */
  const tile = (key: string, children: (RenderElement | null)[], opts: { selected?: boolean; focused?: boolean } = {}) =>
    terminal ? (
      <Box key={key} flexDirection="column" marginTop={1}>
        {children}
      </Box>
    ) : (
      rounded(
        opts.selected ? ((opts.focused ?? paneFocused) ? FILL.selected : FILL.selectedBlurred) : FILL.tile,
        { key, flexDirection: 'column', paddingX: SPACE.item, paddingY: TILE_PAD_Y, rowGap: TILE_ROW_GAP, width: '100%' },
        children,
      )
    )

  /**
   * A thin bar: parts left to right out of `max`, the rest as track. On the
   * terminal one row `width` cells wide (a section body's width by default): the
   * gauge's heavy line, each part in its own colour, `room` parts and the rest
   * as the light rail (see `lineBar`).
   */
  const bar = (parts: Part[], max: number, opts: { height?: number; width?: number } = {}): RenderElement => {
    const total = Math.max(max, parts.reduce((n, p) => n + Math.max(0, p.value), 0), 1)
    if (terminal) {
      const w = opts.width ?? body
      return lineBar(parts, total, w)
    }
    // Grow factors out of 1000 (the desktop caps them at 10000): finer than a pixel at any width.
    // Rounded by SVG end caps around a flat middle. Borders can't round it: on the desktop a
    // border takes room inside the box, so a thin bordered track draws empty and bordered fills
    // draw as blobs; glyph bars (◖━◗, ╺━╸) don't draw at all.
    const height = opts.height ?? BAR
    const shown = parts.filter(p => p.value > 0).map(p => ({ ...p, grow: (p.value / total) * 1000 }))
    const rest = Math.max(0, 1000 - shown.reduce((n, p) => n + p.grow, 0))
    // Not `h`: that's the JSX factory.
    const flat = (rows: number | undefined) => (
      <Box flexDirection="row" flexGrow={1} height={rows} backgroundColor={TRACK} overflow="hidden">
        {/* An explicit full height: the desktop doesn't stretch a child to its parent's height. */}
        {shown.map(p => (
          <Box flexGrow={p.grow} flexShrink={0} width={0} height="100%" backgroundColor={p.color} />
        ))}
        {rest > 0 ? <Box flexGrow={rest} width={0} /> : null}
      </Box>
    )
    // The caps sit inside the bar's width, so a scale under it still lines up with its ends.
    const first = shown[0]?.color ?? TRACK
    const last = rest > 0 ? TRACK : (shown[shown.length - 1]?.color ?? TRACK)
    return capped(height, first, last, flat)
  }

  /**
   * A label as GitHub draws one: a rounded chip filled with the label's colour,
   * faint and see-through (FILL.pill), and its name in the theme's foreground, which
   * reads on the light desktop theme and the dark one whatever the label's colour
   * (a label without a hex colour gets the track's grey). On the
   * terminal, a `■` swatch and the name in the default foreground: a label's
   * colour is data (GitHub's hex) that may not read on the person's theme, so it
   * only ever tints the one-cell swatch, never the text. A status colour (a kit
   * token) draws as its theme key, as everywhere.
   */
  const pill = (key: string, text: string, color: string) => {
    if (terminal) {
      return (
        <Text key={key}>
          <Text {...(isKitColor(color) ? ink(color) : { color })}>■</Text>
          {` ${text}`}
        </Text>
      )
    }
    return rounded(tint(color, FILL.pill) ?? TRACK, { key, flexDirection: 'row', paddingX: 0.6, flexShrink: 0 }, [<Text key="t">{text}</Text>])
  }

  /**
   * A small mark of colour, a legend's key: a dot on the app surfaces, a square
   * `■` on the terminal. `line: true` keys a line bar's part (`k.bar`) on the
   * terminal with its own glyph: `━` for a part, `─` for a `room` one.
   */
  const swatch = (color: string, o: { line?: boolean; room?: boolean } = {}) => (
    <Text {...ink(color)}>{terminal ? (o.line ? (o.room ? METER.rail : METER.line) : '■') : '●'}</Text>
  )

  /**
   * A legend: each entry a key, a dim label and its figure. `note` is an optional
   * coloured figure after it (a failure count). With `bar: true` (a legend that
   * keys a `bar`, its items in the bar's order, `room` ones included) the
   * terminal's keys are the bar's own glyphs, `━` and `─`.
   *
   * On the terminal it's a compact grid, filled row by row in the items' order:
   * as many columns as fit with labels up to 10 cells (`maxCols`, 3 at most),
   * 3 cells apart; then each column takes its share of the row, up to what its
   * longest label, figure and note need, so labels widen into spare room and are
   * cut with … only when it runs out, and a label stays close to its figure. The app surfaces
   * share the row out in up to three columns.
   */
  const legend = (
    key: string,
    items: { label: string; color: string; figure: string; note?: string; noteColor?: string; room?: boolean }[],
    maxCols?: number,
    opts: { bar?: boolean } = {},
  ) => {
    if (terminal) {
      const len = (s: string) => [...s].length
      const longest = Math.max(1, ...items.map(t => len(t.label)))
      const figW = Math.max(1, ...items.map(t => len(t.figure)))
      const noteW = Math.max(0, ...items.map(t => (t.note ? len(t.note) + 1 : 0)))
      const fixed = 2 + 1 + figW + noteW
      const gap = 3
      // How many columns fit is decided at the compact width (labels up to LABEL cells)...
      const compact = fixed + Math.min(LABEL, longest)
      const fit = Math.max(1, Math.floor((body + gap) / (compact + gap)))
      const cols = Math.max(1, Math.min(maxCols ?? 3, fit, items.length))
      const rows = Array.from({ length: Math.ceil(items.length / cols) }, (_, r) => items.slice(r * cols, r * cols + cols))
      // ...then each column takes its share of the row, up to what its longest label needs,
      // and the label has what's left after the key, figure and note.
      const share = Math.floor((body - gap * (cols - 1)) / cols)
      const width = Math.max(1, Math.min(fixed + longest, share))
      const labelRoom = Math.max(1, width - fixed)
      const fitLabel = (s: string) => (len(s) <= labelRoom ? s : [...s].slice(0, Math.max(0, labelRoom - 1)).join('') + MARK.more)
      return (
        <Box key={key} flexDirection="column">
          {rows.map((row, r) => (
            <Box key={`${key}-row-${r}`} flexDirection="row" gap={gap}>
              {row.map(t => (
                <Box key={`${key}-${t.label}`} flexDirection="row" width={width} flexShrink={0}>
                  <Box width={2} flexShrink={0}>
                    {swatch(t.color, { line: opts.bar, room: t.room })}
                  </Box>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text {...R.label} wrap="truncate">
                      {fitLabel(t.label)}
                    </Text>
                  </Box>
                  <Box width={figW + 1} flexShrink={0} flexDirection="row" justifyContent="flex-end">
                    <Text {...R.value}>{t.figure}</Text>
                  </Box>
                  {noteW ? (
                    <Box width={noteW} flexShrink={0} flexDirection="row" justifyContent="flex-end">
                      {t.note ? <Text {...ink(t.noteColor)}>{t.note}</Text> : null}
                    </Box>
                  ) : null}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )
    }
    // Few rows: two columns for up to four entries, three beyond. (The pane's reported
    // width in columns runs smaller than what the desktop draws, so it can't decide this.)
    const cols = Math.min(maxCols ?? 3, items.length <= 4 ? 2 : 3, Math.max(1, items.length))
    const per = Math.ceil(items.length / cols)
    const groups = Array.from({ length: cols }, (_, c) => items.slice(c * per, c * per + per))
    return (
      // The legend spans the body (the desktop doesn't stretch a nested box), and its
      // columns share that width equally, as a bar's parts do: grow from zero width.
      <Box key={key} flexDirection="row" width="100%" gap={space.group}>
        {groups.map((col, c) => (
          <Box key={`${key}-col-${c}`} flexGrow={1} width={0} flexDirection="column">
            {col.map(t => (
              // The full column's width (the desktop doesn't stretch it); the label gives way first.
              <Box key={`${key}-${t.label}`} flexDirection="row" alignItems="center" gap={space.pair} width="100%">
                {swatch(t.color)}
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text {...tone('light')} wrap="truncate">
                    {t.label}
                  </Text>
                </Box>
                {t.note ? <Text {...ink(t.noteColor)}>{t.note}</Text> : null}
                <Text>{t.figure}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  }

  /** A caption: dim uppercase, for a chart's or a column's heading. The only uppercase besides a state word. */
  const caption = (text: string) => <Text {...(terminal ? R.meta : tone('mid'))}>{text.toUpperCase()}</Text>

  /**
   * A header's figures, one form for every section: figures, each followed by
   * a dim lowercase unit, SPACE.group apart. A figure is coloured only when the
   * colour is a status. On the terminal the first figure is bold (the one that
   * matters; put it first) and the rest plain.
   *
   * Its state, before the figures, so a cut never takes it:
   * - `loading`: no figures yet (the first read): the pending mark `◌` holds
   *   their place, so a folded section still says it's coming;
   * - `age`: how old the figures are when they're last-good figures kept through
   *   a refresh, as a dim `↻ 2m`;
   * - `failed`: the last refresh failed and these are the last-good figures: an
   *   amber `▲` (with the age after it, dim, when given). Keep the figures; don't
   *   swap the body for an error.
   */
  const summary = (items: ([string, string?, string?] | null | false)[], state: { loading?: boolean; age?: string; failed?: boolean } = {}) => {
    const shown = items.filter((x): x is [string, string?, string?] => Boolean(x))
    const pending = state.loading && !shown.length
    if (terminal) {
      // One line of text, the figures CELLS.group apart: too wide for its room, it's
      // cut wherever that falls and ends in an ellipsis, never mid-figure without one.
      const mark = state.failed ? (
        <Text key="state">
          <Text {...ink(STATUS.warn.color)}>{STATUS.warn.glyph}</Text>
          {state.age ? <Text {...R.secondary}>{` ${state.age}`}</Text> : null}
          {shown.length ? ' '.repeat(CELLS.group) : null}
        </Text>
      ) : state.age ? (
        <Text key="state" {...R.secondary}>
          {`${MARK.stale} ${state.age}`}
          {shown.length ? ' '.repeat(CELLS.group) : null}
        </Text>
      ) : null
      return (
        <Box flexDirection="row" minWidth={0} flexShrink={1}>
          <Text wrap="truncate">
            {pending ? <Text key="pending" {...ink(STATUS.pending.color)}>{STATUS.pending.glyph}</Text> : null}
            {mark}
            {shown.map(([figure, unit, color], i) => (
              <Text key={`${figure}-${unit ?? ''}`}>
                {i ? ' '.repeat(CELLS.group) : null}
                {/* The first figure is the one that matters: bold; the rest plain. */}
                <Text {...(i ? R.value : R.strong)} {...ink(color)}>{figure}</Text>
                {unit ? <Text {...R.meta}>{` ${unit}`}</Text> : null}
              </Text>
            ))}
          </Text>
        </Box>
      )
    }
    // Too wide for the band, the last item ends in an ellipsis and what's past it is cut.
    return (
      <Box flexDirection="row" gap={space.group} minWidth={0} flexShrink={1} overflow="hidden">
        {pending ? <Text key="pending" color={STATUS.pending.color}>{STATUS.pending.glyph}</Text> : null}
        {state.failed ? (
          <Text key="state">
            <Text color={STATUS.warn.color}>{STATUS.warn.glyph}</Text>
            {state.age ? <Text {...tone('mid')}>{` ${state.age}`}</Text> : null}
          </Text>
        ) : state.age ? (
          <Text key="state" {...tone('mid')}>{`${MARK.stale} ${state.age}`}</Text>
        ) : null}
        {shown.map(([figure, unit, color], i) => (
          <Text key={`${figure}-${unit ?? ''}`} wrap={i === shown.length - 1 ? 'truncate' : undefined}>
            <Text {...ink(color)}>{figure}</Text>
            {unit ? <Text {...tone('mid')}>{` ${unit}`}</Text> : null}
          </Text>
        ))}
      </Box>
    )
  }

  /**
   * Labels under a chart, each centred under its place: `at` from 0 to 1 across
   * the chart's width (the first and last flush with its ends). On the terminal
   * one dim line `width` cells wide (a section body's by default; pass the
   * chart's): a label that would touch the one before it is left out.
   */
  const axis = (key: string, labels: { at: number; text: string }[], width?: number) => {
    const row: RenderElement[] = []
    const sorted = [...labels].sort((a, b) => a.at - b.at)
    if (terminal) {
      const w = Math.max(1, Math.floor(width ?? body))
      const line = Array.from({ length: w }, () => ' ')
      let free = 0
      for (const l of sorted) {
        const text = [...l.text]
        const start = Math.max(0, Math.min(w - text.length, Math.round(clamp01(l.at) * w - text.length / 2)))
        if (start < free || start + text.length > w) continue
        text.forEach((ch, i) => (line[start + i] = ch))
        free = start + text.length + 1
      }
      return (
        <Text key={key} dimColor>
          {line.join('').trimEnd()}
        </Text>
      )
    }
    sorted.forEach((l, i) => {
      // Each label owns the span halfway to its neighbours; the ends own up to the edge.
      const from = i === 0 ? 0 : (sorted[i - 1]!.at + l.at) / 2
      const to = i === sorted.length - 1 ? 1 : (l.at + sorted[i + 1]!.at) / 2
      const align = i === 0 && l.at === 0 ? 'flex-start' : i === sorted.length - 1 && l.at === 1 ? 'flex-end' : 'center'
      row.push(
        <Box key={`${key}-${i}`} flexGrow={Math.max(1, Math.round((to - from) * 1000))} width={0} flexDirection="row" justifyContent={align}>
          <Text {...tone('dark')}>{l.text}</Text>
        </Box>,
      )
    })
    return (
      <Box key={key} flexDirection="row">
        {row}
      </Box>
    )
  }

  /**
   * An instrument's scale under a bar: ticks at 0, 25, 50, 75 and 100%, and a
   * marker where `mark` falls (a fraction of the scale), in `markColor`. On the
   * terminal a row `width` cells wide (a section body's by default, as `bar`):
   * dim ticks (╵) and the marker as ▴.
   */
  const scale = (mark?: number, markColor: string = C.warn, width?: number) => {
    if (terminal) {
      const w = Math.max(2, Math.floor(width ?? body))
      const row = Array.from({ length: w }, () => ' ')
      for (const at of [0, 0.25, 0.5, 0.75, 1]) row[Math.round(at * (w - 1))] = '╵'
      const m = mark === undefined ? -1 : Math.round(clamp01(mark) * (w - 1))
      if (m < 0) return <Text dimColor>{row.join('')}</Text>
      return (
        <Text>
          <Text dimColor>{row.slice(0, m).join('')}</Text>
          <Text {...ink(markColor)}>▴</Text>
          <Text dimColor>{row.slice(m + 1).join('')}</Text>
        </Text>
      )
    }
    // Every tick at its place on the scale, the marker among them, gaps between sized by flex-grow.
    const marks: Array<{ at: number; color: string; height: number }> = [0, 0.25, 0.5, 0.75, 1].map(at => ({ at, color: TRACK, height: 0.3 }))
    if (mark !== undefined) marks.push({ at: Math.max(0, Math.min(1, mark)), color: markColor, height: 0.45 })
    marks.sort((a, b) => a.at - b.at)
    const row: RenderElement[] = []
    marks.forEach((m, i) => {
      if (i > 0) row.push(<Box key={`g${i}`} flexGrow={Math.max(0, (m.at - marks[i - 1]!.at) * 1000)} width={0} />)
      row.push(<Box key={`m${i}`} width={0.12} height={m.height} backgroundColor={m.color} flexShrink={0} />)
    })
    return (
      <Box flexDirection="row" alignItems="flex-start" height={0.45}>
        {row}
      </Box>
    )
  }

  /**
   * A section as a properties inspector draws one (Premiere's Effect Controls):
   * a collapsible header row (icon, title, figures, then the fold arrow last at
   * the right end) and its properties indented under it, the terminal's under the
   * title. The arrow (a Button, key `toggle-<id>`) folds it. No panel, outline or tint: rows and indentation do
   * the grouping. Collapsible when given `onToggle` (the mod keeps which are
   * folded in its state); folded, only the header row shows.
   */
  const section = (s: {
    id: string
    title: string
    /** An icon before the title (a GLYPH, drawn as the kit's SVG icon), always muted. */
    icon?: string
    right?: RenderElement | null
    collapsed?: boolean
    onToggle?: () => void
    /**
     * On the terminal, the right side (figures, buttons) keeps its natural width
     * and only the title is cut, with an ellipsis: for a header whose right side
     * is controls that must all show. Size the right side to fit the row yourself.
     * Without it, the title keeps up to 12 cells and then it and the figures give
     * way together. The desktop draws the same either way.
     */
    keepRight?: boolean
    /** No figures yet: with no `right`, the figure slot shows the pending mark (`summary([], { loading: true })`). */
    loading?: boolean
    /**
     * The figures restate what the body shows (the fullest of the readings under
     * it): the terminal draws them only while the body is hidden, folded or under
     * the narrow floor, so an open section doesn't say it twice.
     */
    restated?: boolean
    children: RenderElement | (RenderElement | null)[] | null
  }) => {
    if (s.loading && !s.right) s = { ...s, right: summary([], { loading: true }) }
    if (terminal) {
      // ◔ Title       figures ─────────────── ▾
      //   body, two cells in, under the title
      // A dim icon, the title bold, the figures on a shared column right after it
      // (TITLE_COL), a dim rule, then the dim fold arrow last, flush right. The icon
      // takes the GUTTER the body is indented by, so a title lines up with the
      // readings under it. No band or box. Every section leaves one blank row under
      // it, open or folded.
      const arrow = s.collapsed ? FOLD.closed : FOLD.open
      const toggle =
        s.onToggle && Button ? (
          <Button key={`toggle-${s.id}`} plain dimColor label={arrow} onPress={() => s.onToggle?.()} />
        ) : (
          <Text dimColor>{arrow}</Text>
        )
      // The arrow keeps its cell whatever else gives way; `gap` is its room when the row has no gap of its own.
      const arrowBox = (gap: number) => (
        <Box key="fold" flexShrink={0} marginLeft={gap}>
          {toggle}
        </Box>
      )
      const lead = s.icon ? GUTTER : 0
      const titleCells = [...s.title].length
      const keeps = Math.min(titleCells, 12)
      // Under MIN_COLUMNS, the header and its figures only: the body is left out.
      const open = !s.collapsed && !floor
      const right = s.restated && open ? null : s.right
      const head = [
        s.icon ? (
          <Box key="icon" width={GUTTER} flexShrink={0}>
            {icon(s.icon, TERM_HEADER_ICON)}
          </Box>
        ) : null,
        <Box key="name" flexShrink={1} minWidth={0}>
          <Text wrap="truncate" {...R.title}>
            {s.title}
          </Text>
        </Box>,
      ]
      // The rule takes only the room left: from no width, cut at its box's edge.
      const rule = (
        <Box key="rule" flexGrow={1} flexShrink={1} width={0} minWidth={0} height={1} overflow="hidden">
          <Text dimColor>{METER.rail.repeat(Math.max(1, Math.floor(columns)))}</Text>
        </Box>
      )
      const row = s.keepRight ? (
        // Controls on the right edge: they keep their width and only the title is cut.
        <Box flexDirection="row" gap={CELLS.item}>
          <Box key="title" flexDirection="row" flexShrink={1} minWidth={lead + 1}>
            {head}
          </Box>
          {rule}
          {right ? (
            <Box key="right" flexDirection="row" minWidth={0} flexShrink={0} overflow="hidden">
              {right}
            </Box>
          ) : null}
          {arrowBox(0)}
        </Box>
      ) : (
        // The title's column gives way first (down to 12 cells of title), then the figures; the rule
        // only ever takes what's left.
        <Box flexDirection="row">
          <Box
            key="title"
            flexDirection="row"
            // Without figures the rule follows the title; with them, they start on the shared column.
            width={lead + (right ? Math.max(TITLE_COL, titleCells) + CELLS.group : titleCells + CELLS.item)}
            flexShrink={1000}
            minWidth={lead + keeps + (right ? CELLS.group : CELLS.item)}
          >
            {head}
          </Box>
          {right ? (
            <Box key="right" flexDirection="row" minWidth={0} flexShrink={1} overflow="hidden" marginRight={CELLS.item}>
              {right}
            </Box>
          ) : null}
          {rule}
          {arrowBox(CELLS.item)}
        </Box>
      )
      return (
        <Box key={`section-${s.id}`} flexDirection="column" width={span} paddingRight={RIGHT} marginBottom={floor ? 0 : 1}>
          {row}
          {open ? (
            <Box flexDirection="column" paddingLeft={GUTTER}>
              {s.children}
            </Box>
          ) : null}
        </Box>
      )
    }
    const arrow = fold(Boolean(s.collapsed))
    const toggle =
      s.onToggle && Button ? (
        <Button key={`toggle-${s.id}`} plain dimColor label={arrow} onPress={() => s.onToggle?.()} />
      ) : (
        <Text dimColor>{arrow}</Text>
      )
    // The icon takes a fixed column, so every title starts at the same x; the figures and
    // then the arrow sit at the right end, the arrow last and flush right. The arrow is a
    // Button's label (the desktop draws a Button's label only), so it shows and is pressed.
    // One standard row above each section, and no other margin: sections sit one row apart.
    return (
      <Box key={`section-${s.id}`} flexDirection="column" marginTop={1}>
        {rounded(
          FILL.head,
          {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: SPACE.item,
            paddingX: terminal ? 0 : INSET,
            ...(terminal ? {} : { height: BAND_ROWS, flexShrink: 0, overflow: 'hidden' }),
          },
          [
            // The title keeps its room; the right side gives way.
            <Box key="title" flexDirection="row" alignItems="center" flexShrink={0}>
              {s.icon ? (
                <Box width={2} flexShrink={0} flexDirection="row" alignItems="center">
                  {icon(s.icon, MUTED)}
                </Box>
              ) : null}
              <Text wrap="truncate" bold>
                {s.title}
              </Text>
            </Box>,
            <Box key="end" flexDirection="row" alignItems="center" justifyContent="flex-end" gap={SPACE.item} minWidth={0} flexShrink={1}>
              {s.right ? (
                <Box key="right" flexDirection="row" minWidth={0} flexShrink={1} overflow="hidden">
                  {s.right}
                </Box>
              ) : null}
              {/* A minimum, not a width: the desktop draws a Button natively, with padding, and clips it to a box too narrow for that. */}
              <Box key="fold" minWidth={1.6} flexShrink={0} flexDirection="row" justifyContent="flex-end">
                {toggle}
              </Box>
            </Box>,
          ],
        )}
        {/* A gentle indent: the body starts inside the icon's column, just past the band's inset. */}
        {s.collapsed ? null : (
          <Box flexDirection="column" paddingLeft={terminal ? GUTTER : BODY_INDENT} paddingRight={terminal ? 0 : INSET} marginTop={terminal ? 0 : 1} marginBottom={terminal ? 0 : 1}>
            {s.children}
          </Box>
        )}
      </Box>
    )
  }

  /**
   * A property row: the dim label on the left edge, the value right-aligned on the
   * right edge. On the terminal, as an inspector lists them: the label in the
   * reading's label column (LABEL cells, wider labels keep their length), the
   * value after it, left-aligned and cut at the edge.
   *
   * `path: true` says a string value is a path (or a branch name): on the
   * terminal it's cut in the middle, keeping its end (`src/…/view.tsx`), to fit
   * `width` (a section body's by default).
   */
  const prop = (key: string, label: string, value: RenderElement | string, opts: { path?: boolean; width?: number } = {}) => {
    if (terminal) {
      const labelWidth = Math.min(Math.max(LABEL, [...label].length), 16)
      const room = Math.max(1, Math.floor(opts.width ?? body) - labelWidth - CELLS.item)
      return (
        <Box key={key} flexDirection="row" gap={CELLS.item}>
          <Box width={labelWidth} flexShrink={0}>
            <Text {...R.label} wrap="truncate">
              {label}
            </Text>
          </Box>
          <Box minWidth={0} flexShrink={1} flexGrow={1}>
            {typeof value === 'string' ? (
              <Text {...R.value} wrap={opts.path ? 'truncate-middle' : 'truncate'}>
                {opts.path ? middle(value, room) : value}
              </Text>
            ) : (
              value
            )}
          </Box>
        </Box>
      )
    }
    return (
    <Box key={key} flexDirection="row" justifyContent="space-between" gap={SPACE.item}>
      {/* The label keeps its word (it's short); a long value is what gets cut. */}
      <Box minWidth={0} flexShrink={0}>
        <Text {...tone('mid')} wrap="truncate">
          {label}
        </Text>
      </Box>
      <Box minWidth={0} flexShrink={1}>
        {typeof value === 'string' ? <Text wrap="truncate">{value}</Text> : value}
      </Box>
    </Box>
    )
  }

  /**
   * A thin rounded gauge, `value` of `max`: a one-part bar. On the terminal a
   * heavy line on a light rail, `width` cells (a section body's by default).
   */
  const gauge = (value: number, max: number, color: string, opts: { width?: number } = {}) =>
    terminal ? lineMeter(value / Math.max(max, 1e-9), color, opts.width ?? body) : bar([{ value, color }], max, { height: 0.3 })

  /**
   * A reading, as an instrument shows one: a dim label, a thin gauge, the value
   * and a dim unit or note, in fixed columns (LABEL | gauge | FIG | FIG2), both
   * figures right-aligned so the last ends on the inset like the header's.
   *
   * On the terminal the row is `width` cells (a section body's by default; pass it
   * when the reading sits deeper or outside a section): the gauge takes what the
   * columns leave; under 6 cells the label narrows, then the gauge is left out.
   */
  const reading = (key: string, r: { label: string; value: number; max: number; color: string; figure: string; unit?: string; unitColor?: string; labelWidth?: number; width?: number }) => {
    if (terminal) {
      const w = Math.floor(r.width ?? body)
      const fixed = FIG + FIG2 + 3 * CELLS.item
      let label = r.labelWidth ?? LABEL
      let room = w - label - fixed
      if (room < MIN_GAUGE) {
        label = Math.max(MIN_LABEL, label - (MIN_GAUGE - room))
        room = w - label - fixed
      }
      const shown = room >= MIN_GAUGE
      if (!shown) label = Math.max(1, w - FIG - FIG2 - 2 * CELLS.item)
      return (
        <Box key={key} flexDirection="row" gap={CELLS.item}>
          <Box width={label} flexShrink={0}>
            <Text {...R.label} wrap="truncate">
              {r.label}
            </Text>
          </Box>
          {shown ? lineMeter(r.value / Math.max(r.max, 1e-9), r.color, room) : null}
          <Box width={FIG} flexShrink={0} flexDirection="row" justifyContent="flex-end">
            <Text {...R.value} wrap="truncate">{r.figure}</Text>
          </Box>
          <Box width={FIG2} flexShrink={0} flexDirection="row" justifyContent="flex-end">
            <Text {...(r.unitColor ? ink(r.unitColor) : R.meta)} wrap="truncate">
              {r.unit ?? ''}
            </Text>
          </Box>
        </Box>
      )
    }
    return (
    <Box key={key} flexDirection="row" alignItems="center" gap={SPACE.item}>
      <Box width={r.labelWidth ?? LABEL} flexShrink={0}>
        <Text {...tone('light')} wrap="truncate">
          {r.label}
        </Text>
      </Box>
      {gauge(r.value, r.max, r.color)}
      <Box width={FIG} flexShrink={0} flexDirection="row" justifyContent="flex-end">
        <Text>{r.figure}</Text>
      </Box>
      <Box width={FIG2} flexShrink={0} flexDirection="row" justifyContent="flex-end">
        <Text {...(r.unitColor ? { color: r.unitColor } : tone('mid'))}>
          {r.unit ?? ''}
        </Text>
      </Box>
    </Box>
    )
  }

  /** A row with a slim coloured rail on the left: a name, a dim note, a figure on the right. */
  const rail = (key: string, r: { color: string; text: string; note?: string; figures?: string[]; indent?: number }) => (
    <Box key={key} flexDirection="row" gap={terminal ? CELLS.pair : 0.75} paddingLeft={r.indent ?? 0}>
      {terminal ? <Text {...ink(r.color)}>▎</Text> : <Box width={0.25} backgroundColor={r.color} flexShrink={0} />}
      <Box flexDirection="row" justifyContent="space-between" flexGrow={1} flexShrink={1} minWidth={0} gap={space.item}>
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate">
            {r.text}
            {r.note ? <Text {...tone('mid')}>{`  ${r.note}`}</Text> : null}
          </Text>
        </Box>
        {/* Figures in fixed right-aligned columns, so they line up row to row. */}
        <Box flexDirection="row" gap={space.item} flexShrink={0}>
          {(r.figures ?? []).map((f, i) => (
            <Box key={`f${i}`} width={FIG} flexDirection="row" justifyContent="flex-end">
              <Text {...tone('mid')}>{f}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )

  /**
   * Stacked columns, one per item, scaled to the tallest; `slots` keeps a fixed
   * column width. On the terminal `height` rows tall (2.5 rounds to 3), to the
   * eighth of a row, each slot as wide as `width` (a section body's) allows with a
   * cell between; each cell takes the colour of the part at its middle.
   */
  const columnsChart = (items: Part[][], opts: { height?: number; slots?: number; width?: number } = {}) => {
    const total = (s: Part[]) => s.reduce((n, p) => n + Math.max(0, p.value), 0)
    const max = Math.max(1, ...items.map(total))
    if (terminal) {
      const rows = Math.max(1, Math.round(opts.height ?? 2.5))
      const slots = Math.max(items.length, opts.slots ?? 0, 1)
      const per = Math.max(1, Math.floor((opts.width ?? body) / slots))
      const wide = per >= 3 ? per - 1 : per
      const gap = per - wide
      // Each column's height in eighths of a row, and the part at a given eighth.
      const tall = items.map(s => (total(s) > 0 ? Math.max(1, Math.round((total(s) / max) * rows * 8)) : 0))
      const partAt = (s: Part[], i: number, e: number) => {
        let acc = 0
        const t = tall[i]!
        for (const p of s.filter(x => x.value > 0)) {
          acc += (p.value / total(s)) * t
          if (e < acc) return p
        }
        return s.filter(x => x.value > 0).pop()
      }
      const lines: RenderElement[] = []
      for (let r = rows - 1; r >= 0; r--) {
        const cells = items.map((s, i) => {
          const level = Math.max(0, Math.min(8, tall[i]! - r * 8))
          const part = level > 0 ? partAt(s, i, r * 8 + level / 2) : undefined
          return (
            <Text key={`c${i}`} {...ink(part?.color ?? MUTED)}>
              {(METER.rise[level] ?? ' ').repeat(wide)}
              {' '.repeat(gap)}
            </Text>
          )
        })
        lines.push(<Text key={`row${r}`}>{cells}</Text>)
      }
      return (
        <Box flexDirection="column" width={per * slots} flexShrink={0}>
          {lines}
        </Box>
      )
    }
    // Columns fill from the left, so column i is centred at (i + 0.5) / slots: where `axis` puts its label.
    const slots = Math.max(items.length, opts.slots ?? 0)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" height={opts.height ?? 2.5} alignItems="flex-end">
          {items.map(s => (
            <Box flexGrow={1} width={0} height={pct(total(s), max)} flexDirection="row" justifyContent="center">
              <Box width="70%" height="100%" flexDirection="column">
                {s
                  .filter(p => p.value > 0)
                  .map(p => (
                    <Box height={pct(p.value, total(s))} backgroundColor={p.color} />
                  ))}
              </Box>
            </Box>
          ))}
          {Array.from({ length: slots - items.length }, () => (
            <Box flexGrow={1} width={0} />
          ))}
        </Box>
        {/* A baseline the columns stand on. */}
        <Box height={0.06} backgroundColor={TRACK} />
      </Box>
    )
  }

  /**
   * A debug footer: what the mod cost, from a `createPerf()` snapshot. One dim
   * line per row's worth: the costliest things in the last minute first, each
   * as its average time and how often it ran; amber past 1 s a minute or a
   * render over 16 ms, red past 5 s a minute.
   */
  const perfFooter = (snap: PerfSnapshot, opts: { max?: number; lead?: RenderElement[] } = {}) => {
    const rows = snap.rows.slice(0, opts.max ?? 6)
    const tone = (r: PerfRow) =>
      r.busyMs > 5_000 ? C.bad : r.busyMs > 1_000 || (r.name === 'render' && r.avgMs > 16) ? C.warn : undefined
    // Muted glyphs; only a slow job's figure takes colour (amber, red).
    const items = [
      // ⏱ has an emoji presentation, so the terminal draws the clock face it has in GLYPH.
      share('perf-since', terminal ? GLYPH.time : '⏱', short(snap.sinceMs), ''),
      ...rows.map(r => share(`perf-${r.name}`, PERF_GLYPH[r.name] ?? '•', r.avgMs > 0 ? ms(r.avgMs) : `${r.perMin}/m`, '', tone(r))),
    ]
    // One row: the lead (when given) and the uptime, or the jobs; what doesn't fit is cut.
    // The column view's switch last, flush right, where the pane is wide enough to split.
    const toggle = flowToggle()
    return footBand([...(opts.lead?.length ? [...opts.lead, items[0]!] : items), ...(toggle ? [toggle] : [])])
  }

  /** A footer's band: one row, cut where it doesn't fit; on the app surfaces a fixed-height fill, its ends on the inset. */
  const footBand = (row: RenderElement[], justify = 'space-between') =>
    terminal ? (
      <Box flexDirection="row" columnGap={2} marginTop={1} overflow="hidden">
        {row}
      </Box>
    ) : (
      rounded(
        FILL.head,
        { flexDirection: 'row', flexWrap: 'nowrap', justifyContent: justify, alignItems: 'center', columnGap: SPACE.item, paddingX: INSET, height: BAND_ROWS, flexShrink: 0, marginTop: SPACE.block, overflow: 'hidden' },
        row,
      )
    )

  /**
   * The column view's switch (KitOptions' `flow`): a quiet action, its label
   * alone as the desktop draws a Button, `columns` while on and a dim `single
   * column` while off. Only on an app surface wide enough to split
   * (`flowSplits`) and with a `toggle` to press; null elsewhere, where it would
   * do nothing.
   */
  const flowToggle = (): RenderElement | null => {
    const sw = opts.flow
    if (!sw?.toggle || !Button || !flowSplits(surface, columns)) return null
    return action({ key: 'flow-toggle', label: sw.on ? 'columns' : 'single column', quiet: !sw.on, onPress: sw.toggle })
  }

  /**
   * A pane's footer for a mod with no perf figures: the column view's switch
   * alone, flush right on the band. Null when there's nothing to draw (the
   * terminal, a sidebar's width, no `flow` toggle given).
   */
  const footer = (): RenderElement | null => {
    const toggle = flowToggle()
    return toggle ? footBand([toggle], 'flex-end') : null
  }

  /**
   * One reading for a footer: a muted glyph, our figure, and the whole it's a
   * share of, dim. `hot` tints our figure (amber, red) when it's a lot.
   */
  const share = (key: string, glyph: string, ours: string, whole: string, hot?: string) => (
    // The glyph in its own box: the desktop drops a space at the start of a Text.
    <Box key={key} flexDirection="row" gap={space.pair} flexShrink={1}>
      {/* The glyph (or word) never breaks: too narrow, the figure after it is cut. */}
      <Box flexShrink={0}>
        <Text {...tone('mid')}>{glyph}</Text>
      </Box>
      <Text wrap="truncate">
        <Text {...ink(hot)}>{ours}</Text>
        {whole ? <Text {...tone('dark')}>{`/${whole}`}</Text> : null}
      </Text>
    </Box>
  )

  /**
   * A pane whose footer stays on the bottom edge: `body` fills the height above it.
   * For the debug footer, or anything that should sit under the content however short it is.
   */
  // `height="100%"` doesn't resolve in a pane, so the column takes the pane's height in
  // rows (`e.props.scroll.bodyRows`) and a growing spacer pushes the footer down. Taller
  // content than that just runs on, footer last.
  const pinned = (body: RenderElement | (RenderElement | null)[], footer: RenderElement, rows?: number) => (
    <Box flexDirection="column" minHeight={rows}>
      {body}
      <Box flexGrow={1} />
      {footer}
    </Box>
  )

  /**
   * A status's mark (STATUS in `@kit/tokens`): its glyph in its colour, and the
   * word after it in the same colour when given (`✓ checks pass`, `◐ running`).
   */
  const status = (kind: StatusKind, label?: string, key?: string) => {
    const s = STATUS[kind]
    return (
      <Text key={key} {...ink(s.color)} wrap="truncate">
        {label ? `${s.glyph} ${label}` : s.glyph}
      </Text>
    )
  }

  /**
   * One row of a list, the shape every list in the mods takes:
   *
   *   [tree][lead] text  note ……………… right figures and actions
   *
   * - `tree`: a connector from `treePrefix` (dim), for nested rows;
   * - `lead`: a status kind, an icon key (drawn in `leadColor`, muted by default)
   *   or an element, in a two-cell column so the text starts on the grid;
   * - `text` truncates first, `note` (dim) runs on after it, plain dim whatever
   *   `textColor` or `bold` the text has;
   * - `right`: figures (strings, dim) and elements, one cluster on the right edge.
   *   On the terminal, once the text is down to its first 6 cells, parts that
   *   declare a `drop` rank (`{ part, drop }`, see RightPart) are left out, the
   *   highest rank first, until the row fits; then the cluster's last element
   *   is cut (a string with an ellipsis), then the ones before it, rather than
   *   running past the edge. Rank parts by how little they tell (an age before a
   *   CI mark), whatever order they're drawn in.
   * - `selected`: the row is the list's current one (a list that takes the
   *   keyboard). Pass it, true or false, on every row of such a list: the
   *   terminal then keeps a one-cell gutter on each, with a `▌` in `suggestion`
   *   and the text bold on the selected row; while the pane isn't `focused`
   *   (the kit's by default), the mark is dim and the text keeps its weight.
   *   The desktop tints the selected row as a selected tile.
   * - `path: true`: the text is a path or branch name: on the terminal it's cut
   *   in the middle (`src/…/view.tsx`) rather than at the end.
   * - `width`: the row's cells on the terminal when it isn't a section body's.
   * - `after`: an element right after the text and note, `space.group` on (a
   *   row's actions, kept beside what they act on rather than alone on the far
   *   edge). It never gives way; the text does.
   */
  const item = (
    key: string,
    r: {
      text: string
      note?: string
      lead?: StatusKind | string | RenderElement | null
      leadColor?: string
      tree?: string
      textColor?: string
      bold?: boolean
      dim?: boolean
      indent?: number
      right?: (RenderElement | string | RightPart | null | false)[]
      selected?: boolean
      focused?: boolean
      path?: boolean
      width?: number
      after?: RenderElement | null
    },
  ) => {
    const lead =
      r.lead == null
        ? null
        : typeof r.lead === 'string'
          ? r.lead in STATUS
            ? status(r.lead as StatusKind)
            : icon(r.lead, r.leadColor ?? MUTED)
          : r.lead
    const parts = (r.right ?? []).filter((x): x is RenderElement | string | RightPart => Boolean(x)).map(x => (isRightPart(x) ? x : { part: x }))
    const focused = r.focused ?? paneFocused
    if (terminal) {
      // The text gives way first (it shrinks a thousand times as fast) down to its first
      // ITEM_KEEPS cells; then ranked parts drop, highest rank first; then the right
      // cluster is cut from its end, so nothing runs past the edge. The note is its own
      // run, plain dim whatever the text's colour or weight.
      const row = Math.max(1, Math.floor(r.width ?? body) - (r.indent ?? 0))
      const gutter = r.selected === undefined ? 0 : 1
      const fixed = gutter + (r.tree ? [...r.tree].length : 0) + (lead ? 2 : 0) + (r.after ? CELLS.group + (cellsOf(r.after) ?? 0) : 0)
      const textCells = [...r.text].length
      const kept = parts.map((p, i) => ({ ...p, i, cells: p.cells ?? cellsOf(p.part) ?? 0 }))
      const clusterCells = () => (kept.length ? kept.reduce((n, p) => n + p.cells, 0) + CELLS.item * kept.length : 0)
      const ranked = kept.filter(p => (p.drop ?? 0) > 0).sort((a, b) => (b.drop ?? 0) - (a.drop ?? 0) || b.i - a.i)
      for (const p of ranked) {
        if (fixed + Math.min(textCells, ITEM_KEEPS) + clusterCells() <= row) break
        kept.splice(kept.indexOf(p), 1)
      }
      const right = kept.map(p => p.part)
      const last = right.length - 1
      const chosen = Boolean(r.selected)
      const look = r.dim ? { dimColor: true } : ink(r.textColor)
      const bold = chosen && focused ? true : r.bold
      const keeps = fixed + Math.min(textCells, ITEM_KEEPS)
      // A path is cut in the middle to the room the row leaves it (whatever the note).
      const text = r.path ? middle(r.text, Math.max(ITEM_KEEPS, row - fixed - clusterCells())) : r.text
      const wrap = r.path && !r.note ? 'truncate-middle' : 'truncate'
      return (
        <Box key={key} flexDirection="row" justifyContent="space-between" gap={CELLS.item} paddingLeft={r.indent ?? 0}>
          <Box flexDirection="row" flexShrink={1000} minWidth={right.length ? keeps : 0}>
            {gutter ? (
              <Box width={1} flexShrink={0}>
                {chosen ? <Text {...ink(C.blue)} dimColor={!focused || undefined}>{MARK.selected}</Text> : <Text> </Text>}
              </Box>
            ) : null}
            {r.tree ? (
              <Box flexShrink={0}>
                <Text dimColor>{r.tree}</Text>
              </Box>
            ) : null}
            {lead ? (
              <Box width={2} flexShrink={0} flexDirection="row">
                {lead}
              </Box>
            ) : null}
            <Box flexShrink={1} minWidth={0}>
              {r.note ? (
                <Text wrap="truncate">
                  <Text bold={bold} {...look}>
                    {text}
                  </Text>
                  <Text {...R.secondary}>{`  ${r.note}`}</Text>
                </Text>
              ) : (
                <Text wrap={wrap} bold={bold} {...look}>
                  {text}
                </Text>
              )}
            </Box>
            {r.after ? (
              <Box flexShrink={0} marginLeft={CELLS.group}>
                {r.after}
              </Box>
            ) : null}
          </Box>
          {right.length ? (
            <Box flexDirection="row" gap={CELLS.item} flexShrink={1} minWidth={0} overflow="hidden">
              {/* The last element gives way first (a thousand times as fast), then the rest. */}
              {right.map((x, i) => (
                <Box key={`r${i}`} flexShrink={i === last ? 1000 : 1} minWidth={0} overflow="hidden">
                  {typeof x === 'string' ? (
                    <Text {...R.meta} wrap="truncate">
                      {x}
                    </Text>
                  ) : (
                    x
                  )}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    }
    const right = parts.map(p => p.part)
    const picked = r.selected ? { backgroundColor: focused ? FILL.selected : FILL.selectedBlurred } : {}
    return (
      <Box key={key} flexDirection="row" justifyContent="space-between" gap={space.item} paddingLeft={r.indent ?? 0} {...picked}>
        <Box flexDirection="row" flexShrink={1} minWidth={0} alignItems="center">
          {r.tree ? (
            <Box flexShrink={0}>
              <Text dimColor>{r.tree}</Text>
            </Box>
          ) : null}
          {lead ? (
            <Box width={2} flexShrink={0} flexDirection="row" alignItems="center">
              {lead}
            </Box>
          ) : null}
          <Box flexShrink={1} minWidth={0}>
            <Text wrap="truncate" bold={r.bold} {...(r.dim ? tone('mid') : ink(r.textColor))}>
              {r.text}
              {r.note ? <Text {...tone('mid')} bold={false}>{`  ${r.note}`}</Text> : null}
            </Text>
          </Box>
          {r.after ? (
            <Box flexShrink={0} marginLeft={SPACE.group}>
              {r.after}
            </Box>
          ) : null}
        </Box>
        {right.length ? (
          <Box flexDirection="row" gap={space.item} flexShrink={0} alignItems="center">
            {right.map((x, i) => (typeof x === 'string' ? <Text key={`r${i}`} {...tone('mid')}>{x}</Text> : x))}
          </Box>
        ) : null}
      </Box>
    )
  }

  /** A tree connector (`TREE` in `@kit/tokens`) for a row at a depth: see `treePrefix`. */
  const tree = (guides: boolean[], last: boolean, depth = guides.length + 1) => treePrefix(guides, last, depth)

  /**
   * A line that stands in for content: `empty` (nothing to list) and `loading`
   * (reading…) dim, `error` a red ✕ (the alert icon on the app surfaces) and the
   * message plain. One line cut at the edge, or with `lines: 2` up to two: on the
   * terminal it breaks between words to fit `width` cells (a section body's by
   * default; pass it when the note sits deeper), and the second line is cut with
   * an ellipsis; on the app surfaces, whose text isn't in cells, it wraps.
   */
  const note = (key: string, text: string, kind: 'empty' | 'loading' | 'error' = 'empty', opts: { lines?: 1 | 2; width?: number } = {}) => {
    const two = opts.lines === 2
    const props = kind === 'error' ? {} : tone('mid')
    const message = (w: number) => {
      if (!two) return <Text {...props} wrap="truncate">{text}</Text>
      if (!terminal) {
        return (
          <Text {...props} wrap="wrap">
            {text}
          </Text>
        )
      }
      const [first, rest] = breakLine(text, w)
      return (
        <Box flexDirection="column" minWidth={0}>
          <Text {...props} wrap="truncate">
            {first}
          </Text>
          {rest ? (
            <Text {...props} wrap="truncate">
              {rest}
            </Text>
          ) : null}
        </Box>
      )
    }
    const w = Math.max(1, Math.floor(opts.width ?? body))
    if (kind !== 'error') {
      return (
        <Box key={key} flexDirection="row" minWidth={0}>
          {message(w)}
        </Box>
      )
    }
    return (
      <Box key={key} flexDirection="row" gap={space.pair} minWidth={0} alignItems={two ? 'flex-start' : 'center'}>
        <Box flexShrink={0}>{terminal ? <Text {...ink(C.bad)}>{STATUS.failed.glyph}</Text> : icon('alert', C.bad)}</Box>
        <Box flexShrink={1} minWidth={0}>
          {message(w - 1 - CELLS.pair)}
        </Box>
      </Box>
    )
  }

  /**
   * One action: a plain button; `quiet` (secondary) dim at rest; `hotkey` a digit
   * or letter that presses it; `autoFocus` holds the focus when the site takes the
   * keyboard, so Enter presses it (give it to the safe choice); `tone: 'danger'`
   * for one that destroys something, its label in the failed colour.
   */
  type Action = { key: string; label: string; onPress: () => void; quiet?: boolean; hotkey?: string; autoFocus?: boolean; tone?: 'danger' }
  const action = (a: Action): RenderElement => {
    const danger = a.tone === 'danger'
    if (!Button) return <Text key={a.key} {...(danger ? ink(C.bad) : a.quiet ? tone('mid') : {})}>{a.label}</Text>
    const hot = { ...(a.hotkey ? { hotkey: a.hotkey } : {}), ...(a.autoFocus ? { autoFocus: true } : {}) }
    // A danger action on the app surfaces: its label as a red Text, and over it a Button
    // whose label is as many Braille blanks (drawn as nothing): the desktop draws a
    // Button's label alone, uncoloured, and never a child Text, so a red child never
    // showed there. A press anywhere on the word is a press of the Button.
    if (danger && !terminal) {
      return (
        <Box key={`${a.key}-danger`} position="relative" flexShrink={0} flexDirection="row">
          <Text {...ink(C.bad)}>{a.label}</Text>
          <Box position="absolute" top={0} left={0}>
            <Button key={a.key} plain label={BLANK.repeat([...a.label].length)} {...hot} onPress={a.onPress} />
          </Box>
        </Box>
      )
    }
    // On the terminal, a red Text in its label's place; the label stays its name.
    if (danger) {
      return (
        <Button key={a.key} plain label={a.label} {...(terminal && a.quiet ? { dimColor: true } : {})} {...hot} onPress={a.onPress}>
          <Text {...ink(C.bad)}>{a.label}</Text>
        </Button>
      )
    }
    // A quiet one dim at rest: `dimColor`, as the desktop draws a Button's label and
    // never its children, so a grey Text inside one never showed in the app.
    return <Button key={a.key} plain label={a.label} {...(a.quiet ? { dimColor: true } : {})} {...hot} onPress={a.onPress} />
  }

  /** A row's actions, one cluster: main ones first, quiet ones after, `space.group` apart on the terminal. */
  const actions = (key: string, list: (Action | null | false)[]) => (
    <Box key={key} flexDirection="row" gap={terminal ? CELLS.group : SPACE.item} flexShrink={0} alignItems="center">
      {list.filter((a): a is Action => Boolean(a)).map(action)}
    </Box>
  )

  /**
   * A key-hint footer: `key what` pairs (keys plain, what they do dim), ` · `
   * apart, on one line `width` cells wide (a section body's by default). Pairs
   * that don't fit are dropped from the end and the line ends in a dim `…`, so
   * put the most used first. Drawn only on the terminal and only while the pane
   * has the keyboard (the kit's `focused`); elsewhere nothing, as the app
   * surfaces' controls are buttons. Never hide a key inside a word.
   */
  const hints = (key: string, list: Hint[], o: { width?: number } = {}): RenderElement | null => {
    if (!terminal || !paneFocused || !list.length) return null
    const w = Math.max(1, Math.floor(o.width ?? body))
    const len = (s: string) => [...s].length
    const shown: Hint[] = []
    let used = 0
    for (let i = 0; i < list.length; i++) {
      const hint = list[i]!
      const cells = (shown.length ? len(MARK.sep) : 0) + len(hint.key) + 1 + len(hint.label)
      // Room for ` …` after it, unless it's the last.
      const tail = i < list.length - 1 ? 1 + len(MARK.more) : 0
      if (used + cells + tail > w) break
      shown.push(hint)
      used += cells
    }
    // Not even the first fits: it's drawn and cut at the edge.
    const drawn = shown.length ? shown : list.slice(0, 1)
    const cut = drawn.length < list.length
    return (
      <Box key={key} flexDirection="row" minWidth={0}>
        <Text wrap="truncate">
          {drawn.map((hint, i) => (
            <Text key={`h${i}`}>
              {i ? <Text {...R.secondary}>{MARK.sep}</Text> : null}
              <Text {...R.value}>{hint.key}</Text>
              <Text {...R.secondary}>{` ${hint.label}`}</Text>
            </Text>
          ))}
          {cut && shown.length ? <Text {...R.secondary}>{` ${MARK.more}`}</Text> : null}
        </Text>
      </Box>
    )
  }

  /**
   * A sparkline: a series over time, oldest left, newest on the right edge,
   * scaled to `max` (the series' largest by default), in `color` (quantity, the
   * default foreground on the terminal, by default).
   *
   * On the terminal, Braille dots `width` cells wide (a section body's by
   * default) and `height` rows tall (1): two points a cell, four levels a row,
   * filled from the bottom, so the last `2 × width` points show. With
   * `glyphs: 'blocks'`, the `columns` eighths instead, a point a cell: for a font
   * without Braille, or counts that should read as bars. On the desktop, an SVG
   * line at the same size; with no SVG, columns.
   */
  const spark = (values: number[], o: { width?: number; height?: number; color?: string; max?: number; glyphs?: 'braille' | 'blocks' } = {}) => {
    const color = o.color ?? INK
    const clean = values.map(v => (Number.isFinite(v) ? Math.max(0, v) : 0))
    const max = o.max && o.max > 0 ? o.max : Math.max(1e-9, ...clean)
    const rows = Math.max(1, Math.round(o.height ?? 1))
    const w = Math.max(1, Math.floor(o.width ?? body))
    const blocks = (n: number) => {
      const recent = clean.slice(-n)
      const items: Part[][] = [...Array.from({ length: n - recent.length }, () => [] as Part[]), ...recent.map(v => [{ value: v, color }])]
      return columnsChart(items, { height: rows, slots: n, width: n })
    }
    if (terminal) {
      if (o.glyphs === 'blocks') return blocks(w)
      const points = clean.slice(-2 * w)
      const pad = 2 * w - points.length
      // Each point's height in dots, from the bottom; anything above zero shows a dot.
      const level = (i: number) => {
        if (i < pad) return 0
        const v = points[i - pad]!
        return v > 0 ? Math.max(1, Math.round((Math.min(v, max) / max) * rows * 4)) : 0
      }
      const lines: RenderElement[] = []
      for (let r = rows - 1; r >= 0; r--) {
        let line = ''
        for (let c = 0; c < w; c++) {
          const a = Math.max(0, Math.min(4, level(2 * c) - r * 4))
          const b = Math.max(0, Math.min(4, level(2 * c + 1) - r * 4))
          line += a || b ? String.fromCharCode(SPARK.base | SPARK.left[a]! | SPARK.right[b]!) : ' '
        }
        lines.push(
          <Text key={`spark${r}`} {...ink(color)}>
            {line}
          </Text>,
        )
      }
      return (
        <Box flexDirection="column" width={w} flexShrink={0}>
          {lines}
        </Box>
      )
    }
    if (!Svg) return blocks(Math.min(clean.length, w) || 1)
    const W = Math.max(8, Math.round(w * COL_PX))
    const H = Math.max(6, Math.round(rows * ROW_PX))
    const n = clean.length
    const at = (v: number, i: number) => `${(n > 1 ? (i / (n - 1)) * (W - 2) + 1 : W / 2).toFixed(1)},${(H - 1 - (Math.min(v, max) / max) * (H - 2)).toFixed(1)}`
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<polyline points="${clean.map(at).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`
    return (
      <Box flexDirection="row" overflow="hidden" minWidth={0}>
        <Svg source={source} alt="sparkline" width={W} height={H} />
      </Box>
    )
  }

  return {
    icon,
    pinned,
    share,
    tile,
    bar,
    capped,
    rounded,
    scale,
    axis,
    legend,
    caption,
    summary,
    gauge,
    reading,
    rail,
    prop,
    swatch,
    pill,
    section,
    columns: columnsChart,
    /** The pane's sections in columns when the desktop pane is wide (see `flow` above); as given otherwise. */
    flow: (key: string, blocks: (RenderElement | null | false | undefined)[], o?: FlowOptions): (RenderElement | null)[] => flow(Box, surface, columns, key, blocks, flowOpts(o)),
    /** How many flow columns `blocks` blocks take at this pane's width, and each one's width (see `flowColumns`). */
    flowColumns: (blocks: number, o?: FlowOptions) => flowColumns(surface, columns, blocks, flowOpts(o)),
    flowToggle,
    footer,
    perf: perfFooter,
    status,
    item,
    tree,
    note,
    action,
    actions,
    hints,
    spark,
    /** Whether the pane has the keyboard, as the kit was told (unknown counts as yes). */
    focused: paneFocused,
    ink,
    space,
    edge,
    /** A section body's width in cells on the terminal: what a bar or gauge spans by default. */
    width: body,
    terminal,
  }
}

export type Kit = ReturnType<typeof kit>
