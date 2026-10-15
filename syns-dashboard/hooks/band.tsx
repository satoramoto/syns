import type { RenderElement, RenderSurface } from 'claude-code'

import { C, MUTED } from '../kit/tokens'
import { BLANK, SPACE, kit } from '../kit/ui'
import type { BandOpen, BrainView, CiRow } from '../types'
import type { Els } from './view'

/*
 * The band above the prompt: an attention center, one line of what needs Ryan,
 * each kind an icon and its count, each one a press that resolves it. Pure:
 * register.tsx reads brain.json and gh and hands the counts in (the engine
 * follows `$` within one file only).
 */

/** A kind of thing that needs Ryan. */
export type KindId = 'approvals' | 'questions' | 'updates' | 'ci'

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

export type BandData = { brain: BrainView | null; failing: CiRow[]; open: BandOpen }

export type BandActions = {
  /** Approvals and questions: runs `/syn:inbox`. */
  inbox: () => void
  /** Unfolds (or folds) the list under a kind. */
  toggle: (open: Exclude<BandOpen, null>) => void
  /** Removes one entry from brain.json's `updates`. */
  dismiss: (text: string) => void
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** The kinds with something in them, in the order they're drawn: blocking first. */
export const attention = (d: Pick<BandData, 'brain' | 'failing'>): Kind[] => {
  const b = d.brain && !d.brain.error ? d.brain : null
  const all: Kind[] = [
    { id: 'approvals', count: b?.approvals.length ?? 0, noun: 'approval', icon: 'alert', color: () => C.warn },
    { id: 'questions', count: b?.questions ?? 0, noun: 'question', icon: 'comment', color: () => MUTED },
    { id: 'ci', count: d.failing.length, noun: 'failing PR', icon: 'pr-closed', color: () => C.bad },
    { id: 'updates', count: b?.updates.length ?? 0, noun: 'update', icon: 'events', color: () => MUTED },
  ]
  return all.filter(k => k.count > 0)
}

/** The band's tree, or null when nothing needs Ryan (the hook then passes). */
export const band = (els: Els, surface: RenderSurface, columns: number, d: BandData, act: BandActions): RenderElement | null => {
  const kinds = attention(d)
  if (!kinds.length) return null
  const { Box, Text } = els
  const Button = els.Button!
  const Link = (els as unknown as { Link: (props: any, ...children: any[]) => RenderElement }).Link
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns)
  const w = Math.max(10, Math.floor(columns))

  const press = (kind: Kind) => () => {
    if (kind.id === 'approvals' || kind.id === 'questions') act.inbox()
    else act.toggle(kind.id)
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

  const row = (
    <Box key="kinds" flexDirection="row" alignItems="center" gap={terminal ? 0 : SPACE.group} minWidth={0}>
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

  // The unfolded list, when its kind still has entries.
  const shown = kinds.find(x => x.id === d.open)
  let list: RenderElement | null = null
  if (shown?.id === 'updates') {
    list = (
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
    )
  } else if (shown?.id === 'ci') {
    list = (
      <Box key="list" flexDirection="column" minWidth={0} marginTop={terminal ? 0 : SPACE.pair}>
        {d.failing.map(pr => {
          const text = `${pr.ref}  ${pr.title}`
          return (
            <Box key={pr.ref} flexDirection="row" minWidth={0}>
              <Link href={pr.url} label={[...text].length > w ? `${[...text].slice(0, w - 1).join('')}…` : text} />
            </Box>
          )
        })}
      </Box>
    )
  }

  // On the desktop, framed as the prompt input below it is: its border (the theme's
  // `promptBorder`, rounded) and its inset. The terminal draws one plain row.
  return terminal ? (
    <Box flexDirection="column" minWidth={0}>
      {row}
      {list}
    </Box>
  ) : (
    <Box flexDirection="column" minWidth={0} borderStyle="round" borderColor="promptBorder" paddingX={1}>
      {row}
      {list}
    </Box>
  )
}
