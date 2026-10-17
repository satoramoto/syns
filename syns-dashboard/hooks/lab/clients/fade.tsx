import type { ClientModule } from 'claude-code'

type State = { step: number }

/** Twelve steps of blue, up and down, every 80 ms: a fade made of colour changes. */
const RAMP = ['#0b1a2e', '#102a4a', '#163a66', '#1c4a82', '#225a9e', '#2f80ed', '#4a90f0', '#66a3f3', '#82b5f5', '#9ec8f8', '#bad9fa', '#d6eafc']

const Fade: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let step = 0
    surface.every(80, () => surface.setState({ step: ++step }))
    surface.setState({ step: 0 })
  }
  const step = surface.state?.step ?? 0
  const i = step % (RAMP.length * 2 - 2)
  const at = i < RAMP.length ? i : RAMP.length * 2 - 2 - i
  return (
    <Box flexDirection="column">
      <Text key="swatch" color={RAMP[at]}>████████ colour step {at}</Text>
      <Text key="dim" dimColor={step % 10 < 5}>dimColor toggled every 5 steps</Text>
    </Box>
  )
}

export default Fade
