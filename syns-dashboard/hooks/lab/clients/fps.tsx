import type { ClientModule } from 'claude-code'

type Props = { ms?: number }
type State = { ticks: number; started: number; now: number }

/**
 * Asks for a tick every `ms` (1 by default) and counts what arrives: the
 * ticks per second it shows are the surface's real frame-clock ceiling.
 */
const Fps: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let ticks = 0
    const started = Date.now()
    surface.every(props.ms ?? 1, () => surface.setState({ ticks: ++ticks, started, now: Date.now() }))
    surface.setState({ ticks: 0, started, now: started })
  }
  const s = surface.state ?? { ticks: 0, started: 0, now: 0 }
  const secs = Math.max(0.001, (s.now - s.started) / 1000)
  return (
    <Box flexDirection="column">
      <Text key="ticks">
        {s.ticks} ticks in {secs.toFixed(1)} s
      </Text>
      <Text key="rate" color="#2f80ed">
        {(s.ticks / secs).toFixed(1)} per second (asked every {props.ms ?? 1} ms)
      </Text>
    </Box>
  )
}

export default Fps
