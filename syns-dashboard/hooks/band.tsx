import type { RenderElement, RenderSurface } from 'claude-code'

import { tokens } from '../kit/format'
import { C, MUTED, levelColor } from '../kit/tokens'
import { BLANK, SPACE, kit } from '../kit/ui'
import type { BandOpen, BrainView, ContextSnap } from '../types'
import { contextBar } from './context'
import type { Els } from './view'

/*
 * The band above the prompt, syn's statusline: the context bar (overview's) and
 * its fill, then an attention center, what needs Ryan, each kind an icon and its
 * count, each one a press that resolves it. Pure:
 * register.tsx reads brain.json and hands the counts in (the engine follows `$`
 * within one file only). PR problems are not here: agents fix those; the pane
 * lists the PRs with their CI.
 */

/** A kind of thing that needs Ryan. */
export type KindId = 'approvals' | 'questions' | 'updates'

export type Kind = {
  id: KindId
  count: number
  /** What the count counts, for the label a reader hears (`2 approvals`). */
  noun: string
  /** The kit icon (desktop SVG, terminal glyph). */
  icon: string
  /** A kit token, read when drawing. */
  color: () => string
}

export type BandData = { brain: BrainView | null; open: BandOpen; context: ContextSnap | null }

export type BandActions = {
  /** Approvals and questions: runs `/syn:inbox`. */
  inbox: () => void
  /** Unfolds (or folds) the list under a kind. */
  toggle: (open: Exclude<BandOpen, null>) => void
  /** Removes one entry from brain.json's `updates`. */
  dismiss: (text: string) => void
  /** Runs `/syn:standup`. */
  standup: () => void
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** The kinds with something in them, in the order they're drawn: blocking first. */
export const attention = (d: Pick<BandData, 'brain'>): Kind[] => {
  const b = d.brain && !d.brain.error ? d.brain : null
  const all: Kind[] = [
    { id: 'approvals', count: b?.approvals.length ?? 0, noun: 'approval', icon: 'alert', color: () => C.warn },
    { id: 'questions', count: b?.questions ?? 0, noun: 'question', icon: 'comment', color: () => MUTED },
    { id: 'updates', count: b?.updates.length ?? 0, noun: 'update', icon: 'events', color: () => MUTED },
  ]
  return all.filter(k => k.count > 0)
}

/** The band's tree: always drawn, the Standup button holding its place before anything else is read. */
export const band = (els: Els, surface: RenderSurface, columns: number, d: BandData, act: BandActions): RenderElement => {
  const kinds = attention(d)
  const ctx = d.context
  const { Box, Text } = els
  const Button = els.Button!
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns)

  const press = (kind: Kind) => () => {
    if (kind.id === 'updates') act.toggle('updates')
    else act.inbox()
  }

  /** One kind: its icon and count, the whole of it one press. */
  const chip = (kind: Kind): RenderElement => {
    const label = plural(kind.count, kind.noun)
    const count = String(kind.count)
    if (terminal) {
      return (
        <Button key={kind.id} plain label={label} onPress={press(kind)}>
          {k.icon(kind.icon, kind.color())}
          {` ${count}`}
        </Button>
      )
    }
    // The desktop draws a Button's label alone, uncoloured: the icon and count as drawn,
    // and over them a Button of blanks, so a press anywhere on the chip is the press.
    return (
      <Box key={kind.id} position="relative" flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={0}>
        {k.icon(kind.icon, kind.color(), undefined, { alt: label })}
        <Text>{count}</Text>
        <Box position="absolute" top={0} left={0}>
          <Button key={`${kind.id}-press`} plain label={BLANK.repeat(3 + count.length)} onPress={press(kind)} />
        </Box>
      </Box>
    )
  }

  const chips = (
    <Box key="kinds" flexDirection="row" alignItems="center" gap={terminal ? 0 : SPACE.group} flexShrink={0}>
      {kinds.map((kind, i) =>
        terminal ? (
          <Box key={`${kind.id}-cell`} flexDirection="row" flexShrink={0}>
            {i ? <Text dimColor>{' · '}</Text> : null}
            {chip(kind)}
          </Box>
        ) : (
          chip(kind)
        ),
      )}
    </Box>
  )

  // Standup leads the line, plain like the pane's: the one thing to press any time.
  // An icon and its word, the whole of it one press, drawn as the chips are (the kit's actions take no icon).
  const standup = terminal ? (
    <Button key="standup" plain label="Standup" onPress={act.standup}>
      {k.icon('checklist', MUTED)}
      {' Standup'}
    </Button>
  ) : (
    <Box key="standup" position="relative" flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={0}>
      {k.icon('checklist', MUTED, undefined, { alt: 'Standup' })}
      <Text>Standup</Text>
      <Box position="absolute" top={0} left={0}>
        <Button key="standup-press" plain label={BLANK.repeat(10)} onPress={act.standup} />
      </Box>
    </Box>
  )
  /** The button's cells on the terminal (icon, space, word) and the gap after it. */
  const STANDUP_COLS = 11

  // The context bar takes what the line leaves: its fill after it, the chips at the end.
  const fill = ctx ? `${ctx.percent}%` : ''
  const of = ctx ? ` of ${tokens(ctx.max)}` : ''
  const chipsCols = kinds.reduce((n, kind, i) => n + (i ? 3 : 0) + 2 + String(kind.count).length, 0)
  const barCols = Math.max(8, columns - STANDUP_COLS - fill.length - of.length - 1 - (kinds.length ? chipsCols + 3 : 0))
  const meter = ctx ? (
    <Box key="ctx" flexDirection="row" alignItems="center" gap={terminal ? 1 : SPACE.item} flexGrow={1} flexShrink={1} minWidth={0}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {k.bar(contextBar(ctx, terminal), ctx.max, { width: barCols })}
      </Box>
      <Text>
        <Text bold color={levelColor(ctx.percent)}>{fill}</Text>
        <Text color={MUTED}>{of}</Text>
      </Text>
    </Box>
  ) : null

  const row = (
    <Box key="line" flexDirection="row" alignItems="center" gap={terminal ? 0 : SPACE.group} minWidth={0}>
      <Box key="standup" flexShrink={0} marginRight={terminal ? 2 : 0}>
        {standup}
      </Box>
      {meter}
      {meter && kinds.length && terminal ? <Text dimColor>{' · '}</Text> : null}
      {kinds.length ? chips : null}
    </Box>
  )

  // The unfolded updates, while there are any.
  const list =
    d.open === 'updates' && kinds.some(x => x.id === 'updates') ? (
      <Box key="list" flexDirection="column" minWidth={0} marginTop={terminal ? 0 : SPACE.pair}>
        {(d.brain?.updates ?? []).map((text, i) => (
          <Box key={`u${i}`} flexDirection="row" alignItems="center" gap={terminal ? 2 : SPACE.item} minWidth={0}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="truncate">{text}</Text>
            </Box>
            {k.actions(`u${i}-acts`, [{ key: `dismiss-${i}-${text.slice(0, 40)}`, label: 'Dismiss', quiet: true, onPress: () => act.dismiss(text) }])}
          </Box>
        ))}
      </Box>
    ) : null

  // No frame of our own. The desktop draws the band inside a lighter, padded, rounded
  // container of its own; the engine gives a hook no way to style it (the tree fills
  // its slot, AbovePrompt's props carry no frame option, no theme key names it), and
  // a border on our Box drew a second box inside it.
  return (
    // On the desktop, inset to the prompt box's own padding below it (~30px across, ~3px more up and down than the container gives).
    <Box flexDirection="column" minWidth={0} {...(terminal ? {} : { paddingX: 2, paddingY: 0.3 })}>
      {row}
      {list}
    </Box>
  )
}
