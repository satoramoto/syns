import type { ClientModule, ClientPointerEvent } from 'claude-code'

type State = { x: number; y: number; type: string; fine?: string; down: boolean }

const ROWS = 5

/** A grid that draws a marker where the pointer is; drag to paint the trail's head. */
const Pointer: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let down = false
    surface.onPointer((e: ClientPointerEvent) => {
      if (e.type === 'down') down = true
      if (e.type === 'up') down = false
      surface.setState({
        x: e.x,
        y: e.y,
        type: e.type,
        fine: e.fine ? `${e.fine.x.toFixed(2)},${e.fine.y.toFixed(2)}` : undefined,
        down,
      })
    })
    surface.setState({ x: -1, y: -1, type: 'none', down: false })
  }
  const s = surface.state ?? { x: -1, y: -1, type: 'none', down: false }
  const cols = Math.max(10, Math.min(surface.columns || 40, 80))
  const rows = []
  for (let y = 0; y < ROWS; y++) {
    let line = ''
    for (let x = 0; x < cols; x++) line += x === s.x && y === s.y ? (s.down ? '█' : '+') : '·'
    rows.push(
      <Text key={`r${y}`} dimColor={y !== s.y}>
        {line}
      </Text>,
    )
  }
  return (
    <Box flexDirection="column">
      {rows}
      <Text key="last">
        {s.type} at {s.x},{s.y}
        {s.fine ? ` fine ${s.fine}` : ''}
      </Text>
    </Box>
  )
}

export default Pointer
