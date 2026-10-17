import type { ClientModule } from 'claude-code'

type Props = { ms?: number }
type State = { on: boolean; ticks: number }

/** A dot that blinks on the surface's frame clock, every `ms` (500 by default). */
const Blink: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let ticks = 0
    surface.every(props.ms ?? 500, () => {
      ticks++
      surface.setState({ on: ticks % 2 === 0, ticks })
    })
    surface.setState({ on: true, ticks: 0 })
  }
  const on = surface.state?.on ?? true
  return (
    <Box flexDirection="row" gap={1}>
      <Text key="dot" color={on ? '#eb5757' : '#3a3a3c'}>●</Text>
      <Text dimColor>{on ? 'on ' : 'off'} tick {surface.state?.ticks ?? 0}</Text>
    </Box>
  )
}

export default Blink
