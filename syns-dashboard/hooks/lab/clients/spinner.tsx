import type { ClientModule } from 'claude-code'

type State = { step: number }

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** A braille spinner at 80 ms a frame. */
const Spinner: ClientModule<{ label?: string }, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let step = 0
    surface.every(80, () => surface.setState({ step: ++step }))
    surface.setState({ step: 0 })
  }
  const step = surface.state?.step ?? 0
  return (
    <Box flexDirection="row" gap={1}>
      <Text key="frame" color="#9b51e0">{FRAMES[step % FRAMES.length]}</Text>
      <Text>{props.label ?? 'working'}</Text>
    </Box>
  )
}

export default Spinner
