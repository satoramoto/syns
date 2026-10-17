// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Modified in the awesome-claude fork (2026): this file is new. Render and
// behaviour tests of the fork's Blast Radius through the engine's test kit.
//
// Modified again when it moved into syns' dashboard plugin (2026): the whole
// dashboard plugin is loaded, so the panes and band are mounted as
// `syns-dashboard`'s, the column switch is its `blastColumns` state, and the
// kit is imported from `../../kit/`.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { C } from '../../kit/tokens'

/** The plugin the hooks are loaded in. */
const PLUGIN = 'syns-dashboard'

// A risky Bash call is held by the mod's tool.call hook. Beneath it, the test
// stands for the engine: `process.run` answers the measuring script with a
// build folder of 13 files, and the hold's `sleep` on the test's clock;
// `ui.open` places the pane or not, and the Bash tool itself answers "ran".
// While the hook holds, the mod's other hooks run between its waits, so the
// test moves the clock on until what it started (a mount, a press) is done.
const RM_OUT = ['13 49152 1', 'build/index.html', 'build/assets/index.js'].join('\n')

const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const PANE = {
  component: 'Pane',
  requestId: 'blast-radius',
  props: { title: 'Blast Radius', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** The engine beneath the mod, with a clock that moves only when the test moves it. */
const engine = (on: On, placed = true, measured = RM_OUT): MockClock => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 11, 12) })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('ui.open', async () => ({ value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'the terminal is too narrow' } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('process.run', async (_$, e) => {
    // The hold's wait, on the test's clock.
    if (e.argv[0] === 'sleep') {
      await clock.sleep(Number(e.argv[1]) * 1000)
      return run('')
    }
    return e.argv[0] === 'bash' ? run(measured) : run('', 1)
  })
  // The Bash tool itself, reached only when the mod lets the call through.
  on('tool.call', async () => ({ result: { stdout: '', stderr: '' }, text: 'ran' }) as any)
  return clock
}

/** Moves the clock a hold's wait at a time until `work` is done (at most a minute of the hold). */
const drive = async <T,>(clock: MockClock, work: Promise<T>): Promise<T> => {
  let done = false
  const settled = work.finally(() => (done = true))
  for (let i = 0; i < 240 && !done; i++) await clock.advance(250)
  return settled
}

/** Holds `rm -rf build`, then draws the component once the mod measured it and opened its pane. */
const hold = async ($: Engine, clock: MockClock, surface: 'terminal' | 'desktop', where: { component: string; props: object } = PANE) => {
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any) as Promise<any>
  await clock.settle()
  const ui = await drive(clock, $.ui.mount({ plugin: PLUGIN, surface, ...where } as any))
  return { call, ui: ui as any }
}

const CANCELLED = 'the user pressed Cancel'

test('the terminal draws the report with the kit inside the warning border, and Cancel refuses the command', async ($, on) => {
  const clock = engine(on)
  const { call, ui } = await hold($, clock, 'terminal')
  // The one round border, in the warning colour's theme key.
  const tree = (await ui.drawn()) as any
  expect(tree.props).toMatchObject({ borderStyle: 'round', borderColor: 'warning' })
  // The head is the command itself, the one bold thing, after the alert glyph; no ⚠ title line (that's the pane's title).
  expect(await ui.find({ type: 'Text', text: '▲' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'rm -rf build' }))?.props).toMatchObject({ bold: true })
  expect(await ui.find({ type: 'Text', text: /Blast Radius|⚠/ })).toBeUndefined()
  // Each fact once: no label that restates the command, no Command row, no "Paths:" note that restates its paths.
  expect(await ui.findAll({ type: 'Text', text: /rm -rf/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'Command' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Paths:/ })).toBeUndefined()
  // Would is quiet: a dim label, then the plain summary, neither bold nor red.
  expect((await ui.find({ type: 'Text', text: 'Would' }))?.props.dimColor).toBe(true)
  const sum = (await ui.find({ type: 'Text', text: 'delete 13 files (about 48 KB)' }))?.props
  expect(sum).toMatchObject({ wrap: 'truncate' })
  expect(sum?.color).toBeUndefined()
  expect(sum?.bold).toBeFalsy()
  // The list as quiet items: the file glyph, then the dim path, cut in the middle.
  expect(await ui.findAll({ type: 'Text', text: '□' })).toHaveLength(2)
  expect((await ui.find({ type: 'Text', text: 'build/assets/index.js' }))?.props).toMatchObject({ wrap: 'truncate-middle', dimColor: true })
  expect(await ui.find({ type: 'Text', text: '+ 11 more' })).toBeDefined()
  // At 60 columns the hint fits beside the actions; they carry hotkeys 1 and 2.
  expect(await ui.find({ type: 'Text', text: 'Claude is waiting on your answer' })).toBeDefined()
  const buttons: { key?: string; props: Record<string, unknown> }[] = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => [b.key, b.props.label, b.props.hotkey])).toEqual([
    ['proceed', 'Proceed', '1'],
    ['cancel', 'Cancel', '2'],
  ])
  // Cancel holds the focus, so Enter refuses, as upstream; Proceed doesn't, and it's red (it destroys).
  expect(buttons.find(b => b.key === 'cancel')?.props).toMatchObject({ autoFocus: true })
  expect(buttons.find(b => b.key === 'proceed')?.props.autoFocus).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Proceed' }))?.props).toMatchObject({ color: 'error' })
  expect((await ui.find({ type: 'Text', text: 'Cancel' }))?.props?.color).toBeUndefined()
  await drive(clock, ui.press({ key: 'cancel' }))
  const result = await drive(clock, call)
  expect(String(result.deny ?? result.text)).toContain(CANCELLED)
  await ui.unmount()
})

test('a wide terminal band names the mod beside the command', async ($, on) => {
  const clock = engine(on, false)
  const { call, ui } = await hold($, clock, 'terminal', BAND)
  expect((await ui.find({ type: 'Text', text: 'Blast Radius' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'rm -rf build' }))?.props.bold).toBe(true)
  await drive(clock, ui.press({ key: 'cancel' }))
  await drive(clock, call)
  await ui.unmount()
})

test('in a narrow terminal band, the report still fits: the command keeps the head, the hint goes, every long text truncates, and Proceed runs', async ($, on) => {
  const clock = engine(on, false)
  const { call, ui } = await hold($, clock, 'terminal', { ...BAND, props: { ...BAND.props, bodyColumns: 30 } })
  expect(await ui.find({ type: 'Text', text: 'Blast Radius' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'rm -rf build' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is waiting on your answer' })).toBeUndefined()
  for (const text of ['rm -rf build', 'delete 13 files (about 48 KB)']) {
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${text.slice(0, 6)}`) }))?.props).toMatchObject({ wrap: 'truncate' })
  }
  expect((await ui.find({ type: 'Text', text: 'build/index.html' }))?.props).toMatchObject({ wrap: 'truncate-middle' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await drive(clock, ui.press({ key: 'proceed' }))
  const result = await drive(clock, call)
  expect(result.deny).toBeUndefined()
  expect(result.text).toBe('ran')
  await ui.unmount()
})

test('in a narrow terminal band, a long note breaks between words onto a second line instead of being cut at the first', async ($, on) => {
  // Nothing matches, so the note says why rm has nothing to remove: 51 cells, in 26.
  const clock = engine(on, false, '0 0 0')
  const { call, ui } = await hold($, clock, 'terminal', { ...BAND, props: { ...BAND.props, bodyColumns: 30 } })
  expect(await ui.find({ type: 'Text', text: "The paths don't exist, so" })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'rm has nothing to remove.' }))?.props).toMatchObject({ wrap: 'truncate', dimColor: true })
  await drive(clock, ui.press({ key: 'cancel' }))
  await drive(clock, call)
  await ui.unmount()
})

test('the desktop draws the held command, what it would delete and real buttons; Cancel refuses', async ($, on) => {
  const clock = engine(on)
  const { call, ui } = await hold($, clock, 'desktop')
  expect(await ui.find({ type: 'Text', text: 'rm -rf' })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: 'rm -rf build' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'delete 13 files (about 48 KB)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'build/assets/index.js' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+ 11 more' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Paths: build' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is waiting on your answer' })).toBeDefined()
  // Not the terminal's drawing: no ⚠ title line.
  expect(await ui.find({ type: 'Text', text: /Blast Radius/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  // The desktop draws a Button's label alone, uncoloured: Proceed's red is a Text under a
  // blank-labelled Button (the kit's danger action), not a red child the app never shows.
  expect((await ui.find({ type: 'Text', text: 'Proceed' }))?.props.color).toBe(C.bad)
  const proceed = ((await ui.findAll({ type: 'Button' })) as { key?: string; props: Record<string, unknown>; children?: unknown[] }[]).find(b => b.key === 'proceed')
  expect(proceed?.props).toMatchObject({ hotkey: '1', label: '⠀'.repeat('Proceed'.length) })
  expect((proceed?.children ?? []).length).toBe(0)
  await drive(clock, ui.press({ key: 'cancel' }))
  const result = await drive(clock, call)
  expect(String(result.deny ?? result.text)).toContain(CANCELLED)
  await ui.unmount()
})

test('Proceed on the desktop lets the command run', async ($, on) => {
  const clock = engine(on)
  const { call, ui } = await hold($, clock, 'desktop')
  await drive(clock, ui.press({ key: 'proceed' }))
  const result = await drive(clock, call)
  expect(result.deny).toBeUndefined()
  expect(result.text).toBe('ran')
  await ui.unmount()
})

test('with no room for a pane, the band on the desktop draws the report and answers the hold', async ($, on) => {
  const clock = engine(on, false)
  const { call, ui } = await hold($, clock, 'desktop', BAND)
  expect(await ui.find({ type: 'Text', text: 'Blast Radius' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'delete 13 files (about 48 KB)' })).toBeDefined()
  await drive(clock, ui.press({ key: 'proceed' }))
  const result = await drive(clock, call)
  expect(result.text).toBe('ran')
  await ui.unmount()
})

test('on the terminal, the keys are said once, on the buttons, not again in a hint line', async ($, on) => {
  const clock = engine(on)
  const { call, ui } = await hold($, clock, 'terminal')
  expect(await ui.find({ type: 'Text', text: /proceed · / })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.hotkey)).toEqual(['1', '2'])
  await drive(clock, ui.press({ key: 'cancel' }))
  await drive(clock, call)
  await ui.unmount()
})

test('in a short terminal band, the list is cut to fit so the actions still show', async ($, on) => {
  // 10 rows: 8 go to the border, head, Would, the actions and the blanks; one file and `+ 12 more` fit.
  const clock = engine(on, false)
  const { call, ui } = await hold($, clock, 'terminal', { ...BAND, props: { ...BAND.props, maxRows: 10, bodyColumns: 60 } })
  expect(await ui.findAll({ type: 'Text', text: '□' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: '+ 12 more' })).toBeDefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await drive(clock, ui.press({ key: 'cancel' }))
  const result = await drive(clock, call)
  expect(String(result.deny ?? result.text)).toContain(CANCELLED)
  await ui.unmount()
})

test('in a narrow terminal band, a long file path is cut in the middle and keeps its name', async ($, on) => {
  const clock = engine(on, false, ['1 100 1', 'build/assets/very/deeply/nested/folder/index.html'].join('\n'))
  const { call, ui } = await hold($, clock, 'terminal', { ...BAND, props: { ...BAND.props, bodyColumns: 30 } })
  expect(await ui.find({ type: 'Text', text: /^build\/.*….*index\.html$/ })).toBeDefined()
  await drive(clock, ui.press({ key: 'cancel' }))
  await drive(clock, call)
  await ui.unmount()
})

type Drawn = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
const kidsOf = (d: Drawn) => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity).filter((c): c is Drawn => !!c && typeof c === 'object')
const everyOf = (d: Drawn): Drawn[] => [d, ...kidsOf(d).flatMap(everyOf)]
const keyOf = (d: Drawn) => String(d.key ?? d.props?.key ?? '')

test('on a wide desktop pane the listed paths sit in columns, each once and in order; the head, summary and buttons stay across', async ($, on) => {
  const clock = engine(on)
  // The sidebar's width first, holding the call; then the same hold drawn in a wide pane.
  const { call, ui: narrow } = await hold($, clock, 'desktop')
  const columnsOf = async (ui: any) => {
    const tree = (await ui.drawn()) as Drawn
    const cols = everyOf(tree).filter(d => d.type === 'Box' && /^lines-col-\d+$/.test(keyOf(d)))
    // Only the paths flow: the head, the summary and the buttons are never inside a column.
    for (const c of cols) expect(everyOf(c).some(d => ['buttons', 'sum', 'head'].includes(keyOf(d)))).toBe(false)
    return cols.map(c => everyOf(c).map(keyOf).filter(k => /^l\d+$/.test(k)))
  }
  expect(await columnsOf(narrow)).toEqual([])
  await narrow.unmount()
  const wide = await drive(clock, $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 120 } } as any))
  expect(await columnsOf(wide)).toEqual([['l0'], ['l1']])
  expect(await wide.find({ type: 'Text', text: 'build/index.html' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: 'build/assets/index.js' })).toBeDefined()
  await drive(clock, wide.press({ key: 'cancel' }))
  await drive(clock, call)
  await wide.unmount()
})

test("the footer's columns switch turns a wide pane's paths to one stack, and the setting stays in the mod's state for the next drawing", async ($, on) => {
  // What the mod writes to its `blastColumns` state, as the host sees it.
  const writes: unknown[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'blastColumns') writes.push(e.value)
    return next(e)
  })
  const clock = engine(on)
  const { call, ui: narrow } = await hold($, clock, 'desktop')
  // A sidebar's width: nothing to switch.
  expect(await narrow.find({ key: 'flow-toggle' })).toBeUndefined()
  await narrow.unmount()
  const flowed = async (ui: any) => everyOf((await ui.drawn()) as Drawn).filter(d => d.type === 'Box' && /^lines-col-\d+$/.test(keyOf(d))).length
  const mount = () => drive(clock, $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 120 } } as any))
  const wide: any = await mount()
  expect(await flowed(wide)).toBe(2)
  // The desktop draws the switch's label as a Text under a blank Button keyed `flow-toggle`
  // (its label Braille blanks, U+2800, so they trail the text).
  expect((await wide.find({ key: 'flow-toggle-press' }))?.text).toMatch(/^columns⠀*$/)
  await drive(clock, wide.press({ key: 'flow-toggle' }))
  expect(writes).toEqual([false])
  await wide.unmount()
  // Drawn again (a reload keeps the mod's state): one stack, the switch dim.
  const again: any = await mount()
  expect(await flowed(again)).toBe(0)
  expect((await again.find({ key: 'flow-toggle-press' }))?.text).toMatch(/^single column⠀*$/)
  await drive(clock, again.press({ key: 'cancel' }))
  await drive(clock, call)
  await again.unmount()
})
