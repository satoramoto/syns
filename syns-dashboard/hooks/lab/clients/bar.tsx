import type { ClientModule } from 'claude-code'

type State = { step: number }

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A bar that grows to the region's width and back, in eighths of a cell, every 50 ms. */
const Bar: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let step = 0
    surface.every(50, () => surface.setState({ step: ++step }))
    surface.setState({ step: 0 })
  }
  const width = Math.max(8, Math.min(surface.columns || 40, 60) - 8)
  const span = width * 8
  const step = surface.state?.step ?? 0
  const i = step % (span * 2)
  const eighths = i < span ? i : span * 2 - i
  const full = Math.floor(eighths / 8)
  const bar = '█'.repeat(full) + EIGHTHS[eighths % 8]
  return (
    <Box flexDirection="row">
      <Text key="bar" color={eighths > span * 0.8 ? '#eb5757' : '#2f80ed'}>{bar.padEnd(width, ' ')}</Text>
      <Text dimColor> {Math.round((eighths / span) * 100)}%</Text>
    </Box>
  )
}

export default Bar
