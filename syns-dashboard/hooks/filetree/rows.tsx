// Changed in this fork (awesome-claude) for the kit's terminal look: colours are the
// kit's terminal inks (theme keys or dim), and the shimmer is a bold band sweeping
// through a row drawn in its activity's colour, not a hex gradient. The cursor row is
// the kit's selected list row: a `▌` gutter mark in `suggestion` (dim while the pane
// doesn't have the keyboard), never a background, which no fixed hex reads on every theme.
// The scrollbar is only its thumb, dim.
import type { ClientModule } from 'claude-code'

/**
 * One run of a row: `c` a colour (an engine theme key, never a hex: the kit's
 * `termInk` gives it), `dc` the terminal's dim, `sh` a shimmer tone (a key of
 * `tones`), `dim` the faint flash.
 */
export type Seg = { t: string; c?: string; dc?: boolean; b?: boolean; s?: boolean; i?: boolean; sh?: string; dim?: boolean; one?: boolean; spin?: boolean; tab?: string }
export type RowSpec = { id: string; left: Seg[]; right: Seg[] }
export type RowsProps = {
  rows: RowSpec[]
  /** The cursor row's id: its one-cell gutter holds `mark`. */
  active: string
  /** The kit's selected-row mark (`MARK.selected`) and its colour (a theme key). */
  mark: string
  markColor?: string
  /** Whether the pane has the keyboard: the mark is dim while it hasn't. */
  focused: boolean
  /** Each shimmer tone's colour on the terminal (a theme key, from the kit's `termInk`). */
  tones: Record<string, string>
  spinner?: string[]
  pointer?: boolean
  /** The scrollbar: its thumb a dim `┃`, no track (a full-height rule beside the names read as a border). */
  bar?: { pos: number; size: number }
  preview?: { text: string; path: string; startLine: number; markdown: boolean }
}
type Local = { phase: number; drag: boolean; ref: { stop?: () => void; unpoint?: () => void } }

const TICK_MS = 90
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** Whether letter `i` of `len` sits in the band the shimmer sweeps across a name. */
function inBand(i: number, phase: number, len: number): boolean {
  const band = ((phase * 1.6) % (len + 8)) - 4
  return Math.abs(i - band) < 1.8
}

const Rows: ClientModule<RowsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { phase: 0, drag: false, ref: {} }
    surface.setState(state)
  }
  const lit = props.rows.some(r => r.left.some(s => s.sh || s.spin) || r.right.some(s => s.sh || s.spin))
  if (lit && !state.ref.stop) {
    state.ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1 })
    })
  } else if (!lit && state.ref.stop) {
    state.ref.stop()
    state.ref.stop = undefined
  }
  if (props.pointer === false) {
    state.ref.unpoint?.()
    state.ref.unpoint = undefined
  } else state.ref.unpoint = surface.onPointer(e => {
    const cur = surface.state ?? state
    const span = Math.max(1, props.rows.length - 1)
    const onBar = Boolean(props.bar) && e.x >= surface.columns - 1
    if (props.bar && (cur.drag || (onBar && e.type === 'down' && (e.button ?? 'left') === 'left'))) {
      if (e.type === 'up' || e.type === 'leave') {
        surface.setState({ ...cur, drag: false })
        return
      }
      if (e.type === 'down' || e.type === 'move') {
        if (!cur.drag) surface.setState({ ...cur, drag: true })
        surface.post({ scrollTo: Math.max(0, Math.min(1, e.y / span)) })
        return
      }
    }
    if (e.type === 'leave' || e.y < 0 || e.y >= props.rows.length) return
    const row = props.rows[e.y]
    if (e.type === 'down' && e.button === 'right' && row?.id) {
      surface.post({ copy: row.id, shift: Boolean(e.shift) })
      return
    }
    if (e.type !== 'down' || (e.button ?? 'left') !== 'left' || !row) return
    // After the one-cell gutter.
    let x = 1
    for (const seg of row.left) {
      const w = [...seg.t].length
      if (seg.tab && e.x >= x && e.x < x + w) {
        surface.post({ tab: seg.tab })
        return
      }
      x += w
    }
    if (row.id) surface.post({ press: row.id, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) })
  })
  surface.onKey(e => surface.post({ key: e.key, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) }))
  // The preview draws in this same element, so the focus a click gave the tree stays put.
  if (props.preview) {
    const { Markdown, Code } = surface.elements
    const p = props.preview
    return p.markdown ? <Markdown text={p.text} /> : <Code source={p.text} path={p.path} startLine={p.startLine} wrap="truncate-end" />
  }
  const frames = props.spinner?.length ? props.spinner : FRAMES
  const draw = (s: Seg) => {
    if (s.spin) {
      return (
        <Text color={s.c} bold={s.b}>
          {s.t + (frames[state.phase % frames.length] ?? '')}
        </Text>
      )
    }
    const tone = s.sh ? props.tones[s.sh] : undefined
    if (!tone) {
      return (
        <Text color={s.c} dimColor={s.dc} bold={s.b} strikethrough={s.s} italic={s.i}>
          {s.t}
        </Text>
      )
    }
    // The faint flash (files Claude touched a moment ago) stays dim and still.
    if (s.one || s.dim) {
      return (
        <Text color={tone} dimColor={s.dim} bold={s.b}>
          {s.t}
        </Text>
      )
    }
    const chars = [...s.t]
    return (
      <Text color={tone}>
        {chars.map((ch, i) => (
          <Text bold={s.b || inBand(i, state.phase, chars.length)}>{ch}</Text>
        ))}
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {props.rows.map((r, i) => (
        <Box flexDirection="row" height={1} overflow="hidden">
          <Box width={1} flexShrink={0}>
            {r.id && r.id === props.active ? (
              <Text color={props.markColor} dimColor={!props.focused || undefined}>
                {props.mark}
              </Text>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Box flexShrink={1} overflow="hidden">
            {r.left.map(draw)}
          </Box>
          <Box flexGrow={1} />
          {r.right.map(draw)}
          {props.bar && <Text dimColor>{i >= props.bar.pos && i < props.bar.pos + props.bar.size ? ' ┃' : '  '}</Text>}
        </Box>
      ))}
    </Box>
  )
}

export default Rows
