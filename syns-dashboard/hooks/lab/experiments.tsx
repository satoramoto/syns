import type { RenderElement } from 'claude-code'

import * as S from './svg'

/*
 * The lab's catalogue: one experiment per question about what the rendering
 * engine accepts. Each `draw` builds its tree from the elements it is handed
 * (`$.ui.resolve(e)` in the engine, Storybook's own in a story) and the global
 * JSX `h`, nothing else, so the same code runs in both.
 */

export type Surface = 'desktop' | 'terminal' | 'vscode' | 'mobile'
export type Group = 'Graphics' | 'Animation' | 'Interaction' | 'Layout' | 'Text' | 'Elements'

export type Experiment = {
  id: string
  group: Group
  title: string
  /** What it tests, one line. */
  question: string
  /** Where it is meant to draw; the tests mount it on the others too, to record refusals. */
  surfaces: Surface[]
  draw: (els: any, surface: string) => RenderElement
}

export const SURFACES: Surface[] = ['desktop', 'terminal', 'vscode', 'mobile']
const REMOTE: Surface[] = ['desktop', 'vscode', 'mobile']
const ALL: Surface[] = SURFACES
const CLIENT: Surface[] = ['terminal', 'desktop']
const FIELDS: Surface[] = ['desktop', 'terminal', 'vscode']

/** Standard padded base64 of bytes; the environment's own `toBase64` is not everywhere. */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ABC[(n >> 18) & 63]! + ABC[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ABC[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ABC[n & 63]! : '='
  }
  return out
}

/** Raster cells: `[codePoint, fg, bg]` u32 triplets, little-endian, base64. */
const cells = (triplets: number[]) => {
  const words = Uint32Array.from(triplets)
  return base64(new Uint8Array(words.buffer))
}

/** A hue ramp across `columns` x `rows` cells, half blocks for two pixels a cell. */
const rampCells = (columns: number, rows: number) => {
  const t: number[] = []
  const rgb = (h: number) => {
    const f = (n: number) => {
      const k = (n + h * 6) % 6
      return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))))
    }
    return (f(5) << 16) | (f(3) << 8) | f(1)
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) t.push(0x2580, rgb((x + y * 2) / columns), rgb((x + y * 2 + 1) / columns))
  }
  return cells(t)
}

/** 16 x 16 RGBA pixels: a radial blob. */
const rgbaBlob = () => {
  const px = new Uint8Array(16 * 16 * 4)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8
      const i = (y * 16 + x) * 4
      px[i] = 47
      px[i + 1] = 128
      px[i + 2] = 237
      px[i + 3] = Math.max(0, Math.round(255 * (1 - d)))
    }
  }
  return base64(px)
}

/** A 1 x 1 PNG pixel. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const svg = (els: any, source: string, alt: string, isInteractive?: boolean, extra?: object) => {
  const { Svg } = els
  return <Svg source={source} alt={alt} isInteractive={isInteractive || undefined} {...extra} />
}

/** A labelled row: a dim label, then what it shows. */
const row = (els: any, label: string, child: any, key?: string) => {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={1}>
      <Box width={18} flexShrink={0}>
        <Text dimColor wrap="truncate-end">
          {label}
        </Text>
      </Box>
      {child}
    </Box>
  )
}

const col = (els: any, ...children: any[]) => {
  const { Box } = els
  return (
    <Box flexDirection="column" gap={1}>
      {children}
    </Box>
  )
}

const note = (els: any, text: string) => {
  const { Text } = els
  return <Text dimColor>{text}</Text>
}

const SAMPLE_TS = `export const total = (xs: number[]) =>
  xs.reduce((sum, x) => sum + x, 0)

// a very long line to see wrapping: ${'abcdefghij '.repeat(12)}
const answer = total([40, 2])`

const SAMPLE_DIFF = `@@ -1,5 +1,6 @@
 import { a } from './a'
-const b = a + 1
+const b = a + 2
+const c = b * 2
 export default b
 // end`

const MARKDOWN = `## Markdown, as a reply draws it

Some **bold**, _italic_, \`code\`, ~~struck~~ and a [link](https://example.com).

| Surface | Svg | Client |
| --- | --- | --- |
| desktop | yes | yes |
| terminal | no | yes |

- one
- two
  - nested

\`\`\`ts
const x: number = 42
\`\`\`

> a quote

<context>a context block, drawn as written here</context>`

/** The colour strings the backgroundColor experiments try, by id. */
const BACKGROUNDS: [string, string][] = [
  ['hex', '#2f80ed'],
  ['hex-short', '#28e'],
  ['hex-alpha', '#2f80ed55'],
  ['named', 'tomato'],
  ['ansi-name', 'blueBright'],
  ['theme-key', 'success'],
  ['rgb', 'rgb(47, 128, 237)'],
  ['rgba', 'rgba(47, 128, 237, 0.3)'],
  ['transparent', 'transparent'],
  ['hsl', 'hsl(140 60% 40%)'],
  ['linear-gradient', 'linear-gradient(90deg, #2f80ed, #9b51e0)'],
  ['radial-gradient', 'radial-gradient(circle, #f2994a, transparent)'],
  ['css-var', 'var(--accent)'],
]

export const experiments: Experiment[] = [
  // Graphics
  {
    id: 'svg-linear-gradient',
    group: 'Graphics',
    title: 'Linear gradients',
    question: 'Does an Svg draw linearGradient fills, horizontal and vertical, with stop-opacity?',
    surfaces: REMOTE,
    draw: els => svg(els, S.LINEAR, 'Two linear gradient bars and a vertical gradient'),
  },
  {
    id: 'svg-radial-gradient',
    group: 'Graphics',
    title: 'Radial gradients',
    question: 'Does an Svg draw radialGradient fills (an off-centre sphere, a fading glow)?',
    surfaces: REMOTE,
    draw: els => svg(els, S.RADIAL, 'A shaded sphere and a glow'),
  },
  {
    id: 'svg-blur',
    group: 'Graphics',
    title: 'Blur filter',
    question: 'Does feGaussianBlur draw, at stdDeviation 1 and 4?',
    surfaces: REMOTE,
    draw: els => svg(els, S.BLUR, 'A square sharp, slightly blurred and very blurred'),
  },
  {
    id: 'svg-drop-shadow',
    group: 'Graphics',
    title: 'Drop shadow',
    question: 'Does feDropShadow draw, and the older blur, offset and merge chain?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SHADOW, 'Two cards with drop shadows'),
  },
  {
    id: 'svg-masks',
    group: 'Graphics',
    title: 'Clip, mask, opacity',
    question: 'Do clipPath, a gradient mask, opacity and fill-opacity draw?',
    surfaces: REMOTE,
    draw: els => svg(els, S.MASKS, 'A clipped circle, a masked fade and translucent bars'),
  },
  {
    id: 'svg-text',
    group: 'Graphics',
    title: 'SVG text and fonts',
    question: 'Which font families, weights, styles, anchors and textPath does Svg text draw?',
    surfaces: REMOTE,
    draw: els => svg(els, S.FONTS, 'Text in sans, serif and mono, and text along a path'),
  },
  {
    id: 'svg-pattern-use',
    group: 'Graphics',
    title: 'Pattern, marker, use',
    question: 'Do pattern fills, markers and symbol + use (internal href) draw?',
    surfaces: REMOTE,
    draw: els => svg(els, S.PATTERN, 'A hatched box, an arrow and two reused dots'),
  },
  {
    id: 'svg-size',
    group: 'Graphics',
    title: 'Svg width and height',
    question: 'Do the width and height props scale the same markup (CSS pixels)?',
    surfaces: REMOTE,
    draw: els =>
      col(
        els,
        row(els, 'markup size', svg(els, S.RADIAL, 'Sphere at its own size')),
        row(els, 'width 120', svg(els, S.RADIAL, 'Sphere at 120 wide', false, { width: 120 })),
        row(els, '480 x 40', svg(els, S.RADIAL, 'Sphere stretched', false, { width: 480, height: 40 })),
      ),
  },
  {
    id: 'svg-limit-ok',
    group: 'Graphics',
    title: 'Svg at 131072 characters',
    question: 'Is an Svg source of exactly 131072 characters accepted?',
    surfaces: REMOTE,
    draw: els => svg(els, S.sized(131072), 'A source exactly at the cap'),
  },
  {
    id: 'svg-limit-over',
    group: 'Graphics',
    title: 'Svg at 131073 characters',
    question: 'Is an Svg source one character past the cap refused, and with what reason?',
    surfaces: [],
    draw: els => svg(els, S.sized(131073), 'A source one past the cap'),
  },
  {
    id: 'svg-not-svg',
    group: 'Graphics',
    title: 'Svg with no <svg> root',
    question: 'Does the validator check that source is an SVG document at all?',
    surfaces: [],
    draw: els => svg(els, '<div>not svg</div>', 'An HTML fragment'),
  },
  {
    id: 'svg-no-alt',
    group: 'Graphics',
    title: 'Svg with an empty alt',
    question: 'Is alt required to be non-empty?',
    surfaces: [],
    draw: els => svg(els, S.RADIAL, ''),
  },
  {
    id: 'scrub-script',
    group: 'Graphics',
    title: 'Scrub: <script>',
    question: 'Is a <script> inside an interactive Svg stripped or blocked? (green text means it did not run)',
    surfaces: REMOTE,
    draw: els => svg(els, S.SCRUB_SCRIPT, 'A script that would rewrite the text', true),
  },
  {
    id: 'scrub-onload',
    group: 'Graphics',
    title: 'Scrub: event attributes',
    question: 'Are onload and onclick attributes stripped in an interactive Svg?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SCRUB_ONLOAD, 'Event attributes that would rewrite the text', true),
  },
  {
    id: 'scrub-href',
    group: 'Graphics',
    title: 'Scrub: external href',
    question: 'Does an <image> or <a> with an external https href load, or is it stripped?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SCRUB_HREF, 'An external image and link', true),
  },
  {
    id: 'scrub-data-href',
    group: 'Graphics',
    title: 'Scrub: data: href',
    question: 'Does an <image> with a data: URI draw?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SCRUB_DATA_HREF, 'A data URI image'),
  },
  {
    id: 'scrub-foreign',
    group: 'Graphics',
    title: 'Scrub: <foreignObject>',
    question: 'Does <foreignObject> HTML draw inside an interactive Svg?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SCRUB_FOREIGN, 'HTML inside foreignObject', true),
  },

  // Animation
  {
    id: 'smil-interactive',
    group: 'Animation',
    title: 'SMIL, interactive',
    question: 'With isInteractive, do SMIL animate/animateTransform blink, fade, rotate, morph d and grow?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SMIL, 'Five SMIL animations', true),
  },
  {
    id: 'smil-image',
    group: 'Animation',
    title: 'SMIL as an image',
    question: 'Without isInteractive (drawn as an image), does SMIL still animate?',
    surfaces: REMOTE,
    draw: els => svg(els, S.SMIL, 'Five SMIL animations, as an image'),
  },
  {
    id: 'css-interactive',
    group: 'Animation',
    title: 'CSS @keyframes, interactive',
    question: 'With isInteractive, do CSS @keyframes in a <style> animate (spin, pulse, slide)?',
    surfaces: REMOTE,
    draw: els => svg(els, S.CSS_KEYFRAMES, 'Three CSS animations', true),
  },
  {
    id: 'css-image',
    group: 'Animation',
    title: 'CSS @keyframes as an image',
    question: 'Without isInteractive, do CSS @keyframes still animate?',
    surfaces: REMOTE,
    draw: els => svg(els, S.CSS_KEYFRAMES, 'Three CSS animations, as an image'),
  },
  {
    id: 'client-blink',
    group: 'Animation',
    title: 'Client: blinking dot',
    question: 'Does a Client surface module blink a dot with surface.every(500) + setState?',
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="blink" module="./clients/blink.tsx" props={{ ms: 500 }} />
    },
  },
  {
    id: 'client-fade',
    group: 'Animation',
    title: 'Client: colour fade',
    question: 'Does stepping a Text colour every 80 ms read as a fade, and dimColor toggle?',
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="fade" module="./clients/fade.tsx" props={{}} />
    },
  },
  {
    id: 'client-bar',
    group: 'Animation',
    title: 'Client: growing bar',
    question: 'Does a bar grow smoothly in eighth-cell steps every 50 ms, sized from surface.columns?',
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="bar" module="./clients/bar.tsx" props={{}} width="100%" />
    },
  },
  {
    id: 'client-spinner',
    group: 'Animation',
    title: 'Client: spinner',
    question: 'Does a braille spinner turn at 80 ms a frame?',
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="spinner" module="./clients/spinner.tsx" props={{ label: 'spinning on the frame clock' }} />
    },
  },
  {
    id: 'client-fps',
    group: 'Animation',
    title: 'Client: frame-clock ceiling',
    question: 'Asked for a tick every 1 ms and every 16 ms, how many ticks a second actually arrive?',
    surfaces: CLIENT,
    draw: els => {
      const { Box, Client } = els
      return (
        <Box flexDirection="column" gap={1}>
          <Client key="fps1" module="./clients/fps.tsx" props={{ ms: 1 }} />
          <Client key="fps16" module="./clients/fps.tsx" props={{ ms: 16 }} />
        </Box>
      )
    },
  },

  // Interaction
  {
    id: 'svg-hover',
    group: 'Interaction',
    title: 'SVG CSS :hover',
    question: 'With isInteractive, does CSS :hover (with transitions) restyle SVG shapes?',
    surfaces: REMOTE,
    draw: els => svg(els, S.HOVER, 'Three cells and a circle that react to hover', true),
  },
  {
    id: 'svg-title',
    group: 'Interaction',
    title: 'SVG <title> tooltip',
    question: 'With isInteractive, does a <title> child show a native tooltip on hover?',
    surfaces: REMOTE,
    draw: els => svg(els, S.TITLE, 'Shapes with tooltips', true),
  },
  {
    id: 'box-hover',
    group: 'Interaction',
    title: 'Box hover',
    question: 'In a keyed Box, do hover backgroundColor, borderColor and a display none to flex reveal apply?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column" gap={1}>
          <Box key="bg" paddingX={1} hover={{ backgroundColor: '#2f80ed' }}>
            <Text hover={{ color: '#ffffff', bold: true }}>hover me: background and text</Text>
          </Box>
          <Box key="border" borderStyle="round" borderColor="#3a3a3c" paddingX={1} hover={{ borderColor: '#27ae60' }}>
            <Text>hover me: border colour</Text>
          </Box>
          <Box key="reveal" flexDirection="row" gap={1}>
            <Text>hover me to reveal:</Text>
            <Box display="none" hover={{ display: 'flex' }}>
              <Text color="#eb5757">revealed</Text>
            </Box>
          </Box>
        </Box>
      )
    },
  },
  {
    id: 'hover-scope',
    group: 'Interaction',
    title: 'Hover scope groups',
    question: 'Do elements sharing a hover scope light together, without a keyed Box?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column" gap={1}>
          <Text hover={{ scope: 'alpha', color: '#2f80ed', bold: true }}>alpha: row one</Text>
          <Text>unrelated row</Text>
          <Text hover={{ scope: 'alpha', color: '#2f80ed', bold: true }}>alpha: row two (lights with one)</Text>
          <Box flexDirection="row" gap={1}>
            <Text hover={{ scope: 'beta', inverse: true }}>beta</Text>
            <Box display="none" hover={{ scope: 'beta', display: 'flex' }}>
              <Text color="#27ae60">beta revealed</Text>
            </Box>
          </Box>
        </Box>
      )
    },
  },
  {
    id: 'box-absolute',
    group: 'Interaction',
    title: 'Absolute hover card',
    question: 'Does a position absolute Box revealed on hover paint over the rows above without moving them?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column">
          <Text>row one</Text>
          <Text>row two</Text>
          <Text>row three</Text>
          <Box key="anchor" flexDirection="row">
            <Text color="#2f80ed">◆ hover this glyph</Text>
            <Box
              position="absolute"
              top={-3}
              left={4}
              display="none"
              hover={{ display: 'flex' }}
              borderStyle="round"
              backgroundColor="#1c1c1e"
              paddingX={1}
            >
              <Text color="#ffffff">a card over the rows above</Text>
            </Box>
          </Box>
          <Text>row after</Text>
        </Box>
      )
    },
  },
  {
    id: 'buttons',
    group: 'Interaction',
    title: 'Button variants',
    question: 'How do plain, primary, secondary, dismiss, hotkey, dimColor and Text children draw?',
    surfaces: ALL,
    draw: els => {
      const { Box, Button, Text } = els
      const nop = () => undefined
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="default" label="Default" onPress={nop} />
            <Button key="primary" label="Primary" variant="primary" onPress={nop} />
            <Button key="secondary" label="Secondary" variant="secondary" onPress={nop} />
            <Button key="dismiss" label="Dismiss" role="dismiss" onPress={nop} />
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button key="plain" plain label="Plain" onPress={nop} />
            <Button key="hot" plain hotkey="1" label="Plain with hotkey" onPress={nop} />
            <Button key="hot2" hotkey="w" label="Hotkey w" onPress={nop} />
            <Button key="dim" dimColor label="Dim" onPress={nop} />
          </Box>
          <Button key="rowbtn" plain onPress={nop}>
            A whole row <Text dimColor>2m ago</Text> <Text color="#27ae60">chip</Text>
          </Button>
        </Box>
      )
    },
  },
  {
    id: 'button-bad-hotkey',
    group: 'Interaction',
    title: 'Button with a two-letter hotkey',
    question: 'Is a hotkey other than one digit or lowercase letter refused?',
    surfaces: [],
    draw: els => {
      const { Button } = els
      return <Button key="bad" hotkey="ab" label="ab" onPress={() => undefined} />
    },
  },
  {
    id: 'button-box-child',
    group: 'Interaction',
    title: 'Button holding a Box',
    question: 'Is a Button with a Box child refused?',
    surfaces: [],
    draw: els => {
      const { Box, Button, Text } = els
      return (
        <Button key="boxed" onPress={() => undefined}>
          <Box>
            <Text>inside</Text>
          </Box>
        </Button>
      )
    },
  },
  {
    id: 'input-select',
    group: 'Interaction',
    title: 'Input and Select',
    question: 'Do Input (label, placeholder, value, submitLabel) and Select draw and take input?',
    surfaces: FIELDS,
    draw: els => {
      const { Box, Input, Select } = els
      return (
        <Box flexDirection="column" gap={1}>
          <Input key="name" label="Name" placeholder="type here" submitLabel="save" onSubmit={() => undefined} onInput={() => undefined} />
          <Input key="prefilled" label="Prefilled" value="hello" onSubmit={() => undefined} />
          <Select
            key="pick"
            label="Pick"
            value="b"
            options={[
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
              { value: 'c', label: 'Gamma' },
            ]}
            onSelect={() => undefined}
          />
        </Box>
      )
    },
  },
  {
    id: 'select-duplicate',
    group: 'Interaction',
    title: 'Select with duplicate values',
    question: 'Are duplicate option values refused?',
    surfaces: [],
    draw: els => {
      const { Select } = els
      return (
        <Select
          key="dup"
          options={[
            { value: 'a', label: 'One' },
            { value: 'a', label: 'Two' },
          ]}
          onSelect={() => undefined}
        />
      )
    },
  },
  {
    id: 'links',
    group: 'Interaction',
    title: 'Links by scheme',
    question: 'Which hrefs draw as links (https, http, file, mailto, javascript) and which as plain text?',
    surfaces: ALL,
    draw: els => {
      const { Box, Link } = els
      return (
        <Box flexDirection="column">
          {row(els, 'https', <Link href="https://example.com" label="https://example.com" />)}
          {row(els, 'http', <Link href="http://example.com" label="http://example.com" />)}
          {row(els, 'file', <Link href="file:///etc/hosts" label="file:///etc/hosts" />)}
          {row(els, 'mailto', <Link href="mailto:someone@example.com" label="mailto:" />)}
          {row(els, 'javascript', <Link href="javascript:alert(1)" label="javascript:" />)}
          {row(els, 'no label', <Link href="https://example.com/bare" />)}
        </Box>
      )
    },
  },
  {
    id: 'link-too-long',
    group: 'Interaction',
    title: 'Link past 2048 characters',
    question: 'Is a Link whose href is longer than 2048 characters refused?',
    surfaces: [],
    draw: els => {
      const { Link } = els
      return <Link href={`https://example.com/${'a'.repeat(2100)}`} label="long" />
    },
  },
  {
    id: 'markdown-links',
    group: 'Interaction',
    title: 'Markdown answering its links',
    question: 'Does onLinkPress take a link press, and pressableLinks narrow which?',
    surfaces: ALL,
    draw: els => {
      const { Markdown } = els
      return (
        <Markdown
          key="md-links"
          text={'Press [this one](https://example.com/mine) or [this other](https://example.com/theirs), which opens normally.'}
          pressableLinks={['https://example.com/mine']}
          onLinkPress={() => undefined}
        />
      )
    },
  },
  {
    id: 'client-pointer',
    group: 'Interaction',
    title: 'Client: pointer following',
    question: 'Does onPointer report down, move, up, enter and leave in cells (and fine sub-cell positions)?',
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="pointer" module="./clients/pointer.tsx" props={{}} width="100%" height={6} />
    },
  },
  {
    id: 'client-keys',
    group: 'Interaction',
    title: 'Client: keys',
    question: 'Once clicked, does a Client receive keys through onKey?',
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="keys" module="./clients/keys.tsx" props={{}} />
    },
  },
  {
    id: 'client-post',
    group: 'Interaction',
    title: 'Client: post round trip',
    question: "Does surface.post reach the hooks module's ui.message, and its { props } answer come back?",
    surfaces: CLIENT,
    draw: els => {
      const { Client } = els
      return <Client key="echo" module="./clients/echo.tsx" props={{}} />
    },
  },

  // Layout
  {
    id: 'borders',
    group: 'Layout',
    title: 'Border styles',
    question: 'Which borderStyle values draw: single, double, round, bold, singleDouble, doubleSingle, classic, arrow, dashed, quote?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      const styles = ['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow', 'dashed', 'quote']
      return (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {styles.map(style => (
            <Box borderStyle={style} borderColor="#2f80ed" paddingX={1}>
              <Text>{style}</Text>
            </Box>
          ))}
          <Box borderStyle="round" borderDimColor paddingX={1}>
            <Text>dim border</Text>
          </Box>
        </Box>
      )
    },
  },
  {
    id: 'border-unknown',
    group: 'Layout',
    title: 'Unknown border style',
    question: 'Is borderStyle "wavy" refused, or drawn without a border?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box borderStyle="wavy" paddingX={1}>
          <Text>borderStyle wavy</Text>
        </Box>
      )
    },
  },
  // One experiment per colour string, so each refusal is its own.
  ...BACKGROUNDS.map(
    ([id, color]): Experiment => ({
      id: `bg-${id}`,
      group: 'Layout',
      title: `backgroundColor ${color}`,
      question: `Is a Box backgroundColor of "${color}" accepted (Box and Text), and what paints?`,
      surfaces: ALL,
      draw: els => {
        const { Box, Text } = els
        return (
          <Box flexDirection="column" gap={1}>
            <Box width={24} height={2} backgroundColor={color} paddingX={1}>
              <Text>Box</Text>
            </Box>
            <Text backgroundColor={color}> Text with it </Text>
          </Box>
        )
      },
    }),
  ),
  {
    id: 'pct-whole',
    group: 'Layout',
    title: 'Whole percentages',
    question: 'Do width percentages (25%, 50%, 100%) lay out?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column" width="100%">
          {['25%', '50%', '100%'].map(w => (
            <Box width={w} backgroundColor="#2f80ed">
              <Text color="#ffffff">{w}</Text>
            </Box>
          ))}
        </Box>
      )
    },
  },
  {
    id: 'pct-fraction',
    group: 'Layout',
    title: 'Fractional percentage',
    question: 'Is width "25.5%" refused?',
    surfaces: [],
    draw: els => {
      const { Box, Text } = els
      return (
        <Box width="25.5%">
          <Text>25.5%</Text>
        </Box>
      )
    },
  },
  {
    id: 'flexgrow-limit',
    group: 'Layout',
    title: 'flexGrow past 10000',
    question: 'Is flexGrow 10001 refused?',
    surfaces: [],
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexGrow={10001}>
          <Text>flexGrow 10001</Text>
        </Box>
      )
    },
  },
  {
    id: 'fractional-cells',
    group: 'Layout',
    title: 'Fractional heights and margins',
    question: 'Are fractional height and margin values accepted?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column">
          <Box height={1.5} marginTop={0.5} backgroundColor="#27ae60">
            <Text>height 1.5, marginTop 0.5</Text>
          </Box>
          <Text>after</Text>
        </Box>
      )
    },
  },
  {
    id: 'flex',
    group: 'Layout',
    title: 'Flex layout',
    question: 'Do gap, wrap, justifyContent, alignItems, flexGrow and overflow hidden lay out as Ink does?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>left</Text>
            <Text>centre</Text>
            <Text>right</Text>
          </Box>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            {Array.from({ length: 12 }, (_, i) => (
              <Text>item{i}</Text>
            ))}
          </Box>
          <Box flexDirection="row">
            <Box flexGrow={1} backgroundColor="#2f80ed">
              <Text>grow 1</Text>
            </Box>
            <Box flexGrow={3} backgroundColor="#9b51e0">
              <Text>grow 3</Text>
            </Box>
          </Box>
          <Box width={12} height={1} overflow="hidden">
            <Text>overflow hidden cuts this long text</Text>
          </Box>
        </Box>
      )
    },
  },

  // Text
  {
    id: 'text-styles',
    group: 'Text',
    title: 'Text styles',
    question: 'Do bold, italic, underline, strikethrough, inverse, dimColor, color and backgroundColor draw?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column">
          <Text bold>bold</Text>
          <Text italic>italic</Text>
          <Text underline>underline</Text>
          <Text strikethrough>strikethrough</Text>
          <Text inverse>inverse</Text>
          <Text dimColor>dimColor</Text>
          <Text color="#eb5757">color #eb5757</Text>
          <Text color="warning">color theme key warning</Text>
          <Text backgroundColor="#2f80ed" color="#ffffff">
            backgroundColor
          </Text>
          <Text>
            nested: <Text bold>bold</Text> and <Text color="#27ae60">green</Text> in one line
          </Text>
        </Box>
      )
    },
  },
  {
    id: 'text-wrap',
    group: 'Text',
    title: 'Text wrap modes',
    question: 'How do wrap, end, middle, truncate, truncate-start, truncate-middle and truncate-end cut a long line?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      const long = 'The quick brown fox jumps over the lazy dog and keeps running past the edge of the pane'
      const modes = ['wrap', 'end', 'middle', 'truncate', 'truncate-start', 'truncate-middle', 'truncate-end']
      return (
        <Box flexDirection="column">
          {modes.map(m =>
            row(
              els,
              m,
              <Box width={30}>
                <Text wrap={m}>{long}</Text>
              </Box>,
            ),
          )}
        </Box>
      )
    },
  },
  {
    id: 'text-hover',
    group: 'Text',
    title: 'Text hover',
    question: 'Does Text hover (colour, bold, underline, inverse) apply inside a keyed Box?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box key="texthover" flexDirection="column">
          <Text hover={{ color: '#2f80ed' }}>colour on hover</Text>
          <Text hover={{ bold: true, underline: true }}>bold and underline on hover</Text>
          <Text dimColor hover={{ dimColor: false, inverse: true }}>dim to inverse on hover</Text>
        </Box>
      )
    },
  },
  {
    id: 'text-hover-unkeyed',
    group: 'Text',
    title: 'Text hover outside a keyed Box',
    question: 'Is a Text hover with no keyed Box and no scope refused?',
    surfaces: [],
    draw: els => {
      const { Text } = els
      return <Text hover={{ color: '#2f80ed' }}>unkeyed hover</Text>
    },
  },
  {
    id: 'text-long',
    group: 'Text',
    title: 'Text past 100000 characters',
    question: 'Is a 120000-character Text accepted, and cut at 100000?',
    surfaces: ALL,
    draw: els => {
      const { Text } = els
      return <Text>{'0123456789'.repeat(12000)}</Text>
    },
  },
  {
    id: 'text-glyphs',
    group: 'Text',
    title: 'Glyphs and emoji',
    question: 'Do box drawing, blocks, braille, CJK and emoji draw in Text?',
    surfaces: ALL,
    draw: els => {
      const { Box, Text } = els
      return (
        <Box flexDirection="column">
          <Text>box ┌─┬─┐ ╭─╮ ═ ║ blocks ▁▂▃▄▅▆▇█ ░▒▓</Text>
          <Text>braille ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ ⣿⣀</Text>
          <Text>CJK 漢字 かな 한글</Text>
          <Text>emoji 🚀 ✅ 👩‍💻 🏳️‍🌈</Text>
        </Box>
      )
    },
  },

  // Elements
  {
    id: 'code-source',
    group: 'Elements',
    title: 'Code: source',
    question: 'Does Code highlight TypeScript with a startLine gutter, and wrap vs truncate-end long lines?',
    surfaces: ALL,
    draw: els => {
      const { Box, Code } = els
      return (
        <Box flexDirection="column" gap={1}>
          <Code source={SAMPLE_TS} language="typescript" startLine={41} />
          <Code source={SAMPLE_TS} path="example.ts" wrap="truncate-end" />
        </Box>
      )
    },
  },
  {
    id: 'code-diff',
    group: 'Elements',
    title: 'Code: diff',
    question: "Does Code format 'diff' draw a unified diff with gutters and colours?",
    surfaces: ALL,
    draw: els => {
      const { Code } = els
      return <Code source={SAMPLE_DIFF} format="diff" path="b.ts" />
    },
  },
  {
    id: 'code-bad-diff',
    group: 'Elements',
    title: 'Code: diff with no hunk header',
    question: "Is a 'diff' with no @@ header refused, or drawn as plain code?",
    surfaces: ALL,
    draw: els => {
      const { Code } = els
      return <Code source={'-old\n+new'} format="diff" />
    },
  },
  {
    id: 'code-bad-wrap',
    group: 'Elements',
    title: "Code: wrap 'truncate'",
    question: "Is Code wrap 'truncate' (a Text spelling) refused?",
    surfaces: [],
    draw: els => {
      const { Code } = els
      return <Code source="x" wrap="truncate" />
    },
  },
  {
    id: 'markdown',
    group: 'Elements',
    title: 'Markdown',
    question: 'Does Markdown draw headings, emphasis, tables, lists, fences, quotes and a <context> block?',
    surfaces: ALL,
    draw: els => {
      const { Markdown } = els
      return <Markdown text={MARKDOWN} />
    },
  },
  {
    id: 'raster',
    group: 'Elements',
    title: 'Raster',
    question: 'Does a Raster draw a hue ramp of half-block cells with per-cell fg and bg?',
    surfaces: ['terminal'],
    draw: els => {
      const { Raster } = els
      return <Raster key="ramp" columns={48} rows={4} cells={rampCells(48, 4)} />
    },
  },
  {
    id: 'raster-wide-cell',
    group: 'Elements',
    title: 'Raster with a wide cell',
    question: 'Is a Raster cell holding a width-2 character refused, naming its index?',
    surfaces: [],
    draw: els => {
      const { Raster } = els
      return <Raster key="wide" columns={2} rows={1} cells={cells([0x41, 0xffffff, 0x01000000, 0x6f22, 0xffffff, 0x01000000])} />
    },
  },
  {
    id: 'image-png',
    group: 'Elements',
    title: 'Image: PNG',
    question: 'Does an Image of a base64 PNG draw (kitty graphics) or fall back to alt?',
    surfaces: ['terminal'],
    draw: els => {
      const { Image } = els
      return <Image key="png" source={{ png: PNG }} columns={8} rows={4} alt="a one-pixel PNG, scaled" />
    },
  },
  {
    id: 'image-rgba',
    group: 'Elements',
    title: 'Image: RGBA',
    question: 'Does an Image of raw RGBA bytes (16 x 16, with alpha) draw?',
    surfaces: ['terminal'],
    draw: els => {
      const { Image } = els
      return <Image key="rgba" source={{ rgba: rgbaBlob(), width: 16, height: 16 }} columns={8} rows={4} alt="a blue blob" />
    },
  },
]

/** The experiments by group, in catalogue order. */
export const GROUPS: Group[] = ['Graphics', 'Animation', 'Interaction', 'Layout', 'Text', 'Elements']

export const byId = (id: string) => experiments.find(x => x.id === id)

/**
 * The experiments verdicts.json records the desktop refusing; the gallery
 * leaves them out so its one tree validates. lab.test.ts checks this list
 * against the run's own verdicts.
 */
export const DESKTOP_REFUSED = [
  'svg-limit-over',
  'button-bad-hotkey',
  'button-box-child',
  'select-duplicate',
  'link-too-long',
  'bg-radial-gradient',
  'pct-fraction',
  'flexgrow-limit',
  'text-hover-unkeyed',
  'code-bad-wrap',
]

/**
 * What the gallery draws, in group order: every experiment the desktop
 * accepts. `text-long` goes last: a tree draws its first 100000 characters of
 * text, and its 120000 would cut every experiment after it.
 */
export const galleryExperiments = () => {
  const shown = GROUPS.flatMap(g => experiments.filter(x => x.group === g && !DESKTOP_REFUSED.includes(x.id)))
  return [...shown.filter(x => x.id !== 'text-long'), ...shown.filter(x => x.id === 'text-long')]
}
