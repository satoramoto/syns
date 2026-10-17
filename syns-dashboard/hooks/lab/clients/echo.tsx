import type { ClientModule } from 'claude-code'

type Props = { pong?: number; via?: string }
type State = { sent: number }

/** Posts a ping to the hooks module, whose `ui.message` hook answers new props: a round trip. */
const Echo: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  const sent = surface.state?.sent ?? 0
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key="ping"
        label={`ping ${sent + 1}`}
        onPress={() => {
          surface.setState({ sent: sent + 1 })
          surface.post({ ping: sent + 1 })
        }}
      />
      <Text key="pong">
        {props.pong === undefined ? 'no answer yet' : `pong ${props.pong} via ${props.via ?? '?'}`}
      </Text>
    </Box>
  )
}

export default Echo
