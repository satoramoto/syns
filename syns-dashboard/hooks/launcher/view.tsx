import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { basename, bytes, middle } from '../../kit/format'
import { C, GRAY, MUTED, STATUS } from '../../kit/tokens'
import type { StatusKind } from '../../kit/tokens'
import { CELLS, EDGE, MEASURE, SPACE, kit } from '../../kit/ui'
import type { FlowSwitch } from '../../kit/ui'

import type { KillConfirm, LaunchConfig, LaunchFile, Server, Status } from '../../types'

/** What the pane draws with; the terminal's table has the same elements, Svg aside. */
export type PaneElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Link'> & Partial<Pick<Elements['desktop'], 'Svg'>>

/** What the pane's controls do; the hooks module runs them with its `$`. */
export type Actions = {
  start: (name: string) => void
  stop: (name: string) => void
  restart: (name: string) => void
  /** Takes over the server another process runs on its port, so Stop works on it. */
  adopt: (name: string) => void
  /** Kill's press: the first arms the confirm, a second within its time ends the process on the port. */
  kill: (name: string) => void
  /** Unfolds a configuration's details and output, or folds them. */
  toggle: (name: string) => void
}

/**
 * Each state's word and colour: grey stopped, blue starting, green answering, red
 * failed; and the kit status that draws it on the terminal (its glyph in the same colour).
 */
export const LOOK: Record<Status, { word: string; color: string; kind: StatusKind }> = {
  stopped: { word: 'stopped', color: MUTED, kind: 'stopped' },
  starting: { word: 'starting', color: C.blue, kind: 'running' },
  running: { word: 'running', color: C.ok, kind: 'done' },
  elsewhere: { word: 'running elsewhere', color: C.ok, kind: 'done' },
  // Amber: it can't start on its own port until that process ends (or autoPort moves it).
  taken: { word: 'port taken', color: C.warn, kind: 'warn' },
  failed: { word: 'failed', color: C.bad, kind: 'failed' },
}

/** Where a server answers. */
export const urlOf = (port: number) => `http://localhost:${port}`

/** The command line a configuration runs, as one would type it. */
export const commandOf = (c: LaunchConfig) => [c.runtimeExecutable, ...c.runtimeArgs].map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')

/** A configuration not yet probed reads as stopped on its own port. */
const serverOf = (c: LaunchConfig, servers: Record<string, Server>): Server =>
  servers[c.name] ?? { status: 'stopped', port: c.port, log: [], code: null, startedAt: 0 }

/** How many output lines an unfolded row shows. */
const TAIL = { terminal: 8, app: 14 } as const

/**
 * The cells of title a terminal row keeps before its right side gives up parts,
 * and the header's gaps either side of its rule (which may shrink to nothing).
 */
const TITLE_KEEPS = 12
const RULE_GAPS = 2

/**
 * A desktop row's measure, in columns, to tell whether its address fits: the band's
 * inset and its fold arrow (at the row's right end), the gap between parts, and the room a
 * native Button takes beyond its label.
 */
const DESK_LEAD = 4
const DESK_GAP = 1
const DESK_BUTTON = 1
/** The columns a desktop prop's label and the body's indents take, left of a value. */
const DESK_PROP_LABEL = 14

/** The cells of a running server's CPU sparkline on the terminal: the last 12 samples. */
const SPARK_CELLS = 6
/** The CPU percent a sparkline's top stands for at least, so an idle server's noise stays low. */
const SPARK_FLOOR = 10

/**
 * A state's word on the terminal, after its glyph: shorter than `LOOK`'s where the
 * glyph's colour already says it (a server running elsewhere is a green ✓ and "elsewhere").
 */
const TERM_WORD: Record<Status, string> = {
  stopped: 'stopped',
  starting: 'starting',
  running: 'running',
  elsewhere: 'elsewhere',
  taken: 'taken',
  failed: 'failed',
}

/**
 * What every terminal row's right side gives up as the pane narrows, one step at a
 * time and the same step for every row, so their columns stay aligned: the address
 * shortens to its port, then the CPU sparkline goes, then Take over (Kill stays),
 * then the state's word (the glyph stays), then the address, then Restart (it
 * stays in `/launcher restart`).
 */
type Fit = { address: 'full' | 'port' | null; spark: boolean; word: boolean; restart: boolean; adopt: boolean }
const FITS: Fit[] = [
  { address: 'full', spark: true, word: true, restart: true, adopt: true },
  { address: 'port', spark: true, word: true, restart: true, adopt: true },
  { address: 'port', spark: false, word: true, restart: true, adopt: true },
  { address: 'port', spark: false, word: true, restart: true, adopt: false },
  { address: 'port', spark: false, word: false, restart: true, adopt: false },
  { address: null, spark: false, word: false, restart: true, adopt: false },
  { address: null, spark: false, word: false, restart: false, adopt: false },
]

/**
 * A server's terminal log as it reads unfolded: without the lines the props above
 * it already say (the `$ command` this session wrote first, and `exited with code N`
 * when the exit prop shows it), blank lines trimmed from its ends and runs of them
 * kept to one, then its last `n` lines.
 */
const quietLog = (c: LaunchConfig, s: Server, n: number) => {
  let lines = s.log.slice()
  if (lines[0] === `$ ${commandOf(c)}`) lines = lines.slice(1)
  const exitShown = s.status === 'failed' && s.code !== null
  const blank = (l: string) => !l.trim()
  while (lines.length && blank(lines[lines.length - 1]!)) lines.pop()
  if (exitShown && lines[lines.length - 1] === `exited with code ${s.code}`) lines.pop()
  lines = lines.filter((l, i) => !blank(l) || (i > 0 && !blank(lines[i - 1]!)))
  while (lines.length && blank(lines[0]!)) lines.shift()
  while (lines.length && blank(lines[lines.length - 1]!)) lines.pop()
  return lines.slice(-n)
}

/** Notes that mean something went wrong reading the file, rather than there being none. */
const isError = (note: string) => /^(Unreadable|Could not)/.test(note)

const cells = (s: string) => [...s].length

/** A CPU sample as a figure: a tenth under 10% (an idle server's 0.3%), whole above. */
const percent = (cpu: number) => `${cpu < 10 ? cpu.toFixed(1).replace(/\.0$/, '') : Math.round(cpu)}%`

/**
 * What the pane can draw of each server: everything but its CPU and memory as
 * kept, those as the figures and sparkline show them (the samples the line
 * spans, its top, the last figure, the memory's). Two equal ones draw alike,
 * so a refresh that changes neither need not redraw.
 */
export const drawnServers = (servers: Record<string, Server>) =>
  Object.fromEntries(
    Object.entries(servers).map(([name, { cpu, rss, ...s }]) => [
      name,
      {
        ...s,
        cpu: cpu ? [cpu.length >= 2, cpu.slice(-2 * SPARK_CELLS).map(percent), percent(Math.max(SPARK_FLOOR, ...cpu))] : null,
        rss: rss ? bytes(rss) : null,
      },
    ]),
  )

/**
 * The pane, on every surface: the project as a plain line (on the desktop with how
 * many answer), then one foldable row per configuration. On the terminal each
 * row's state, address, CPU and buttons sit in columns shared by every row:
 *
 *   yahaha/.claude/launch.json
 *
 *   app        ──── ✓ running    localhost:5173  ⣀⣤⣶⣤⣀⣀  Stop  Restart ▸
 *
 *   storybook  ──── ✕ failed     :6006                   Start         ▾
 *     command    npm --prefix app run storybook
 *     exit       1
 *
 *     > storybook dev -p 6006
 *     Error: …
 *
 * `focused` is whether the pane has the keyboard (`e.props.isFocused`). The
 * launcher binds no keys of its own (its controls are buttons), so it draws no
 * key hints.
 */
export const renderPane = (
  els: PaneElements,
  surface: RenderSurface,
  columns: number,
  file: LaunchFile | null,
  servers: Record<string, Server>,
  open: string[],
  act: Actions,
  opts: { focused?: boolean; confirm?: KillConfirm | null; flow?: FlowSwitch } = {},
): RenderElement => {
  const { Box, Text, Link } = els
  const terminal = surface === 'terminal'
  // On the terminal the rows keep to the measure, so a row's state and controls stay
  // near its name however wide the pane. The column view's switch is the app surfaces' alone.
  const k = kit(els, surface, columns, { focused: opts.focused, ...(terminal ? { measure: MEASURE } : { flow: opts.flow }) })
  if (!file) return terminal ? k.note('reading', 'Reading .claude/launch.json…', 'loading') : <Text dimColor>Reading .claude/launch.json…</Text>
  if (file.note) {
    return (
      <Box flexDirection="column" paddingLeft={terminal ? 0 : EDGE.left} paddingRight={terminal ? 0 : EDGE.right} marginTop={terminal ? 0 : 1}>
        {terminal ? (
          k.note('note', file.note, isError(file.note) ? 'error' : 'empty')
        ) : (
          <Text dimColor wrap="truncate">
            {file.note}
          </Text>
        )}
      </Box>
    )
  }

  const all = file.configs.map(c => ({ c, s: serverOf(c, servers) }))
  // A row's width on the desktop: the pane's, or a flow column's when the pane is wide enough for columns.
  const lane = k.flowColumns(all.length).width
  const answering = all.filter(x => x.s.status === 'running' || x.s.status === 'elsewhere').length
  const failed = all.filter(x => x.s.status === 'failed').length

  const isUp = (s: Server) => s.status === 'running' || s.status === 'elsewhere'
  /**
   * What can be done to a server: Start while it's stopped or failed; Stop and the
   * quiet Restart while it runs from here (started or taken over); Take over and
   * Kill while its own server runs elsewhere; Kill (and Start on the next port,
   * with autoPort) while another process holds its port. Kill asks once more
   * (`Kill PID 1234?`, red) before it ends anything.
   */
  const controls = (c: LaunchConfig, s: Server) => {
    const mine = s.status === 'running' || s.status === 'starting'
    const canStart = s.status === 'stopped' || s.status === 'failed' || (s.status === 'taken' && Boolean(c.autoPort))
    const held = (s.status === 'elsewhere' || s.status === 'taken') && Boolean(s.pid)
    const armed = Boolean(held && opts.confirm && opts.confirm.name === c.name && opts.confirm.pid === s.pid)
    return {
      start: canStart ? { key: `start-${c.name}`, label: 'Start', onPress: () => act.start(c.name) } : null,
      stop: mine ? { key: `stop-${c.name}`, label: 'Stop', onPress: () => act.stop(c.name) } : null,
      restart: mine ? { key: `restart-${c.name}`, label: 'Restart', quiet: true, onPress: () => act.restart(c.name) } : null,
      adopt: held && s.status === 'elsewhere' ? { key: `adopt-${c.name}`, label: 'Take over', quiet: true, onPress: () => act.adopt(c.name) } : null,
      kill: held
        ? armed
          ? { key: `kill-${c.name}`, label: `Kill PID ${s.pid}?`, tone: 'danger' as const, onPress: () => act.kill(c.name) }
          : { key: `kill-${c.name}`, label: 'Kill', quiet: true, onPress: () => act.kill(c.name) }
        : null,
    }
  }
  /** A row's actions in order: the main ones, then the quiet ones, less Restart or Take over where the row has no room for them. */
  const listOf = (a: ReturnType<typeof controls>, fit: { restart: boolean; adopt: boolean }) => [
    a.start,
    a.stop,
    fit.restart ? a.restart : null,
    fit.adopt ? a.adopt : null,
    a.kill,
  ]
  /** Where a server answers on a terminal row, whole; one that doesn't answer shows its port. */
  const addressOf = (s: Server) => (isUp(s) ? `localhost:${s.port}` : `:${s.port}`)
  /** A server's CPU series once there's a line to draw: answering, two samples or more. */
  const sparkOf = (s: Server) => (isUp(s) && s.cpu && s.cpu.length >= 2 ? s.cpu : null)

  /**
   * The terminal rows' shared columns: each slot's cells (the widest row's) and the
   * one `Fit` that leaves every title its first `TITLE_KEEPS` cells and a rule.
   */
  const grid = (() => {
    if (!terminal) return null
    const max = (ns: number[]) => Math.max(0, ...ns)
    const word = max(all.map(({ s }) => cells(TERM_WORD[s.status])))
    const full = max(all.map(({ s }) => cells(addressOf(s))))
    const port = max(all.map(({ s }) => cells(`:${s.port}`)))
    const spark = all.some(({ s }) => sparkOf(s) !== null)
    const labels = (c: LaunchConfig, s: Server, fit: Fit) =>
      listOf(controls(c, s), fit)
        .filter(x => x !== null)
        .map(x => x.label)
    const actions = (fit: Fit) =>
      max(all.map(({ c, s }) => {
        const l = labels(c, s, fit)
        return l.reduce((n, x) => n + cells(x), 0) + CELLS.group * Math.max(0, l.length - 1)
      }))
    const state = (fit: Fit) => 1 + (fit.word ? CELLS.item + word : 0)
    const total = (fit: Fit) => {
      const slots = [
        state(fit),
        fit.address ? (fit.address === 'full' ? full : port) : 0,
        fit.spark && spark ? SPARK_CELLS : 0,
        actions(fit),
      ].filter(n => n > 0)
      return slots.reduce((a, b) => a + b, 0) + CELLS.group * (slots.length - 1)
    }
    const title = Math.min(max(all.map(({ c }) => cells(c.name))), TITLE_KEEPS)
    const room = k.width - title - RULE_GAPS
    const fit = FITS.find(f => total(f) <= room) ?? FITS[FITS.length - 1]!
    return {
      fit,
      state: state(fit),
      address: fit.address === 'full' ? full : port,
      spark: fit.spark && spark,
      actions,
    }
  })()

  /**
   * One row's right side: its state, where it answers or its port, then what can be
   * done to it. On the terminal, slots aligned across the rows (`grid`); the section
   * (`keepRight`) keeps them whole and cuts the title to what's left.
   */
  const row = (c: LaunchConfig, s: Server) => {
    const look = LOOK[s.status]
    const up = isUp(s)
    const acts = controls(c, s)

    const where = (label: string) =>
      up ? (
        <Link key={`url-${c.name}`} href={urlOf(s.port)} label={label}>
          <Text {...k.ink(C.blue)} wrap="truncate">
            {label}
          </Text>
        </Link>
      ) : (
        <Text key="port" {...(terminal ? { dimColor: true } : { color: GRAY.mid })} wrap="truncate">{`:${s.port}`}</Text>
      )

    if (terminal && grid) {
      // [glyph word]  [address]  [sparkline]  [actions], each slot as wide as the
      // widest row's, so the rows' states, addresses and buttons line up.
      const status = STATUS[look.kind]
      const fit = grid.fit
      const address = fit.address === 'full' ? addressOf(s) : `:${s.port}`
      const cpu = sparkOf(s)
      const shown = listOf(acts, fit)
      const right = (
        <Box key={`right-${c.name}`} flexDirection="row" gap={CELLS.group}>
          <Box key={`state-${c.name}`} flexDirection="row" gap={CELLS.item} width={grid.state} flexShrink={0}>
            <Text {...k.ink(status.color)}>{status.glyph}</Text>
            {fit.word ? (
              <Box key={`word-${c.name}`} flexDirection="row" minWidth={0}>
                <Text {...k.ink(status.color)} wrap="truncate">
                  {TERM_WORD[s.status]}
                </Text>
              </Box>
            ) : null}
          </Box>
          {fit.address ? (
            <Box key={`where-${c.name}`} flexDirection="row" width={grid.address} flexShrink={0}>
              {up ? (
                <Link key={`url-${c.name}`} href={urlOf(s.port)} label={address}>
                  <Text wrap="truncate">
                    {address}
                  </Text>
                </Link>
              ) : (
                <Text dimColor wrap="truncate">
                  {address}
                </Text>
              )}
            </Box>
          ) : null}
          {grid.spark ? (
            <Box key={`cpu-${c.name}`} flexDirection="row" width={SPARK_CELLS} flexShrink={0}>
              {cpu ? (
                <Box key={`spark-${c.name}`} flexDirection="row">
                  {k.spark(cpu, { width: SPARK_CELLS, max: Math.max(SPARK_FLOOR, ...cpu) })}
                </Box>
              ) : null}
            </Box>
          ) : null}
          {grid.actions(fit) ? (
            <Box key={`do-${c.name}`} flexDirection="row" width={grid.actions(fit)} flexShrink={0}>
              {shown.some(Boolean) ? k.actions(`actions-${c.name}`, shown) : null}
            </Box>
          ) : null}
        </Box>
      )
      return { title: c.name, right }
    }

    // The state's word keeps its width; the address gives way first, and drops
    // out when the row can't hold it beside the title, the word and the actions.
    const shown = listOf(acts, { restart: true, adopt: true }).filter(x => x !== null)
    const address = up ? `localhost:${s.port}` : `:${s.port}`
    const need =
      DESK_LEAD + cells(c.name) + DESK_GAP + cells(look.word) + DESK_GAP + cells(address) + shown.reduce((n, a) => n + DESK_GAP + cells(a.label) + DESK_BUTTON, 0)
    const right = (
      <Box key="right" flexDirection="row" alignItems="center" gap={SPACE.item} minWidth={0} flexShrink={1}>
        <Box key={`state-${c.name}`} flexShrink={0}>
          <Text key="state" color={look.color}>
            {look.word}
          </Text>
        </Box>
        {need <= lane ? (
          <Box key={`where-${c.name}`} flexDirection="row" minWidth={0} flexShrink={1}>
            {where(address)}
          </Box>
        ) : null}
        {shown.length ? k.actions(`actions-${c.name}`, shown) : null}
      </Box>
    )
    return { title: c.name, right }
  }

  /** Unfolded: what it runs, where, how it ended, then the tail of its output. */
  const details = (c: LaunchConfig, s: Server) => {
    const tail = terminal ? quietLog(c, s, TAIL.terminal) : s.log.slice(-TAIL.app)
    const held = s.status === 'elsewhere' || s.status === 'taken'
    const note = s.adopted
      ? `Taken over: its output can't be shown here, as it writes to wherever it was started, not to the launcher.`
      : s.status === 'elsewhere'
        ? `Port ${s.port} answers, but this session didn't start it.`
        : s.status === 'taken'
          ? `Port ${s.port} is held by another process, not this configuration's server.`
          : null
    const line = (key: string, text: string) =>
      terminal ? (
        k.note(key, text)
      ) : (
        <Text key={key} dimColor wrap="truncate">
          {text}
        </Text>
      )
    // The process holding the port, cut in the middle so its start and end both show.
    const proc = (held || s.adopted) && s.command ? s.command : null
    return [
      k.prop(`command-${c.name}`, 'command', commandOf(c)),
      c.cwd ? k.prop(`cwd-${c.name}`, 'cwd', c.cwd) : null,
      // On the terminal, what the header's sparkline last measured, as figures.
      terminal && s.cpu?.length ? k.prop(`cpu-${c.name}`, 'cpu', percent(s.cpu[s.cpu.length - 1]!)) : null,
      terminal && s.cpu?.length && s.rss ? k.prop(`memory-${c.name}`, 'memory', `${bytes(s.rss)}B`) : null,
      (held || s.adopted) && s.pid ? k.prop(`pid-${c.name}`, 'pid', String(s.pid)) : null,
      proc
        ? terminal
          ? k.prop(`process-${c.name}`, 'process', proc, { path: true })
          : k.prop(`process-${c.name}`, 'process', middle(proc, Math.max(16, lane - DESK_PROP_LABEL)))
        : null,
      note ? line(`note-${c.name}`, note) : null,
      s.status === 'failed' && s.code !== null ? k.prop(`exit-${c.name}`, 'exit', <Text {...k.ink(C.bad)}>{String(s.code)}</Text>) : null,
      // A server running elsewhere writes its output there: no empty log to show.
      !tail.length && (held || s.adopted) ? null : tail.length ? (
        // The output is its own block: one blank row under the props.
        <Box key={`log-${c.name}`} flexDirection="column" marginTop={terminal ? k.space.block : SPACE.block} minWidth={0}>
          {tail.map((line, i) =>
            terminal ? (
              k.note(`log-${c.name}-${i}`, line || ' ')
            ) : (
              <Text key={`log-${c.name}-${i}`} dimColor wrap="truncate">
                {line || ' '}
              </Text>
            ),
          )}
        </Box>
      ) : terminal ? (
        <Box key={`log-${c.name}`} flexDirection="column" marginTop={k.space.block}>
          {k.note(`log-${c.name}-none`, 'No output yet.')}
        </Box>
      ) : (
        <Text key={`log-${c.name}`} dimColor>
          No output yet.
        </Text>
      ),
    ]
  }

  const rows: RenderElement[] = all.map(({ c, s }) =>
    k.section({
      id: c.name,
      ...row(c, s),
      keepRight: true,
      collapsed: !open.includes(c.name),
      onToggle: () => act.toggle(c.name),
      children: details(c, s),
    }),
  )

  const path = `${basename(file.root) || file.root}/.claude/launch.json`
  const counts = k.summary([
    [String(answering), 'running', answering ? C.ok : undefined],
    failed ? [String(failed), 'failed', C.bad] : null,
  ])
  const empty = 'No configurations in .claude/launch.json.'

  if (terminal) {
    // The file's path as a dim head line (no counts: every row's header says its
    // state), one blank row, then the sections from the pane's left edge. The path
    // ends where the rows' rules do.
    return (
      <Box flexDirection="column">
        <Box key="top" flexDirection="column" marginBottom={1}>
          {k.item('head', { text: path, dim: true, path: true, width: k.edge.left + k.width })}
        </Box>
        {rows.length ? rows : k.note('empty', empty)}
      </Box>
    )
  }

  const head = (
    <Box key="head" flexDirection="row" justifyContent="space-between" gap={SPACE.item} width="100%">
      <Box flexShrink={1} minWidth={0}>
        <Text color={GRAY.mid} wrap="truncate">
          {path}
        </Text>
      </Box>
      {counts}
    </Box>
  )

  return (
    // The sections run the pane's full width, as the overview's do; the plain line sits on the body's edges.
    <Box flexDirection="column" marginTop={1}>
      <Box key="top" flexDirection="column" paddingLeft={EDGE.left} paddingRight={EDGE.right}>
        {head}
        {rows.length ? null : <Text dimColor>{empty}</Text>}
      </Box>
      {/* In columns when the pane is wide; one stack at a sidebar's width. */}
      {k.flow('sections', rows)}
      {/* The column view's switch, on a pane wide enough for columns. */}
      {k.footer()}
    </Box>
  )
}
