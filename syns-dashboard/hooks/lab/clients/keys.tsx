import type { ClientKeyEvent, ClientModule } from 'claude-code'

type State = { last: string; count: number }

/** Shows the last key the region received once a click gave it the focus. */
const Keys: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let count = 0
    surface.onKey((e: ClientKeyEvent) => {
      const mods = [e.ctrl && 'ctrl', e.shift && 'shift', e.meta && 'meta'].filter(Boolean).join('+')
      surface.setState({ last: mods ? `${mods}+${e.key}` : e.key, count: ++count })
    })
    surface.setState({ last: 'none', count: 0 })
  }
  return (
    <Box flexDirection="column">
      <Text dimColor>click here, then type (Esc hands the keys back)</Text>
      <Text key="last">
        last key {surface.state?.last ?? 'none'} ({surface.state?.count ?? 0})
      </Text>
    </Box>
  )
}

export default Keys
