import { expect, test } from 'claude-code/testing'

import { DESKTOP_REFUSED, GROUPS, SURFACES, experiments, galleryExperiments } from './experiments'

/*
 * Mounts every experiment's pane on every surface and records what the engine
 * made of the tree: accepted (and, for the live ones, what driving it did) or
 * refused, with the engine's reason. The run prints one `VERDICTS {json}` line;
 * syns-dashboard/hooks/lab/verdicts.json is that line, kept.
 *
 * The lab is the dashboard's Lab tab: the whole syns-dashboard plugin is
 * loaded, `/lab` opens its pane on that tab, and the index draws under the
 * tab row. Each experiment keeps a pane of its own (`lab-<id>`).
 *
 * The kit validates trees and runs Client modules on a mocked frame clock; it
 * never paints, so whether an accepted SVG blurs or a SMIL animation moves is
 * for a person to look at (`/lab <id>` in the desktop app).
 */

declare const console: { log: (...args: unknown[]) => void }

const PANE = { title: 'Lab', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const VIEWPORT = { columns: 80, rows: 40, isFullscreen: true }
/** The plugin the lab lives in, and the pane its index draws in (on the Lab tab). */
const PLUGIN = 'syns-dashboard'
const DASH = 'syns-dashboard'

/** `/lab` as the person types it: the dashboard's tab state set to the Lab tab, its pane opened. */
const runLab = ($: any, args = '') =>
  $.command.run({ command: 'lab', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

/** Answers `$.ui.open` (the pane is placed), recording each pane opened. */
const stubOpen = (on: any, opened: { id: string; title?: string }[] = []) => {
  on('ui.open', async (_$: unknown, e: any) => {
    opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } }
  })
  return opened
}

/** The dashboard's pane on the Lab tab: `/lab` run, then the pane mounted. */
const mountIndex = async ($: any, surface: string, bodyColumns: number = PANE.bodyColumns): Promise<Ui> => {
  await runLab($)
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: { ...PANE, title: 'syn', bodyColumns }, requestId: DASH, viewport: VIEWPORT })
}

type Verdict = { accepted: boolean; note: string }
type Ui = any

const reasonOf = (err: unknown) => {
  const text = String((err as Error)?.message ?? err)
  const m = /refused: (.*?)(; the engine drew its own|$)/s.exec(text)
  return (m ? m[1]! : text).replace(/\s+/g, ' ').trim()
}

/** Every Text a Client's module drew, joined: what it shows. */
const shown = async (ui: Ui, inside: string) =>
  (await ui.findAll({ type: 'Text', in: inside })).map((t: any) => t.text).join(' | ')

/** The colour of the first Text a Client's module drew. */
const firstColor = async (ui: Ui, inside: string) => (await ui.find({ type: 'Text', in: inside }))?.props?.color

const SCRUB = 'the validator passes the markup whole (drawn() holds it unchanged); any scrub is the surface page\'s, paint unverified'
const ANIM = 'accepted as markup; whether it moves is paint, unverified headlessly'

/** What an accepted tree means where the kit cannot see the paint. */
const NOTES: Record<string, string> = {
  'svg-limit-ok': 'exactly 131072 characters accepted',
  'svg-not-svg': 'the validator does not parse the SVG: any string up to the cap is accepted',
  'svg-no-alt': 'an empty alt is accepted',
  'scrub-script': SCRUB,
  'scrub-onload': SCRUB,
  'scrub-href': SCRUB,
  'scrub-data-href': SCRUB,
  'scrub-foreign': SCRUB,
  'smil-interactive': ANIM,
  'smil-image': ANIM,
  'css-interactive': ANIM,
  'css-image': ANIM,
  'svg-hover': 'accepted; hover is paint, unverified headlessly',
  'svg-title': 'accepted; tooltip is paint, unverified headlessly',
  'border-unknown': 'accepted; per the docs drawn with no border and logged (the kit does not surface the log)',
  'code-bad-diff': 'accepted; per the docs drawn as plain code and logged (the kit does not surface the log)',
  'text-long': 'accepted; per the docs the first 100000 characters draw, then a note of how much is cut',
  'fractional-cells': 'fractional height and margin accepted',
}

/** What driving a live experiment did, read back through the kit. */
const PROBES: Record<string, (ui: Ui) => Promise<string>> = {
  'client-blink': async ui => {
    const a = await firstColor(ui, 'blink')
    await ui.advance(500)
    const b = await firstColor(ui, 'blink')
    await ui.advance(500)
    const c = await firstColor(ui, 'blink')
    return `dot colour ${a} -> ${b} -> ${c} at 500 ms steps`
  },
  'client-fade': async ui => {
    const a = await firstColor(ui, 'fade')
    await ui.advance(400)
    const b = await firstColor(ui, 'fade')
    return `colour ${a} -> ${b} after advance(400)`
  },
  'client-bar': async ui => {
    await ui.resize({ columns: 40, rows: 1, in: 'bar' })
    await ui.advance(1000)
    const a = await shown(ui, 'bar')
    await ui.advance(1000)
    const b = await shown(ui, 'bar')
    return `at 40 columns: 1 s "${a.replace(/ +/g, ' ')}", 2 s "${b.replace(/ +/g, ' ')}"`
  },
  'client-spinner': async ui => {
    const frames = [await shown(ui, 'spinner')]
    for (let i = 0; i < 2; i++) {
      await ui.advance(80)
      frames.push(await shown(ui, 'spinner'))
    }
    return `frames ${frames.map(f => f.split(' | ')[0]).join(' ')} at 80 ms`
  },
  'client-fps': async ui => {
    await ui.advance(1000)
    return `mocked clock, 1 s: every(1) "${(await shown(ui, 'fps1')).split(' | ')[0]}", every(16) "${(await shown(ui, 'fps16')).split(' | ')[0]}"`
  },
  'client-pointer': async ui => {
    await ui.resize({ columns: 40, rows: 6, in: 'pointer' })
    await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'pointer' })
    await ui.pointer({ type: 'move', x: 5, y: 2, in: 'pointer' })
    const moved = (await shown(ui, 'pointer')).split(' | ').pop()
    await ui.pointer({ type: 'down', x: 7, y: 3, button: 'left', in: 'pointer' })
    await ui.pointer({ type: 'move', x: 50, y: 9, button: 'left', fine: { x: 50.25, y: 9.5 }, in: 'pointer' })
    const dragged = (await shown(ui, 'pointer')).split(' | ').pop()
    return `"${moved}"; drag past the edge "${dragged}"`
  },
  'client-keys': async ui => {
    await ui.key({ key: 'a', in: 'keys' })
    await ui.key({ key: 'right', ctrl: true, in: 'keys' })
    return `"${(await shown(ui, 'keys')).split(' | ').pop()}"`
  },
  'client-post': async ui => {
    await ui.press({ key: 'ping' })
    const pressed = (await shown(ui, 'echo')).split(' | ').pop()
    await ui.post({ ping: 41 }, { in: 'echo' })
    const posted = (await shown(ui, 'echo')).split(' | ').pop()
    return `press -> "${pressed}"; post {ping:41} -> "${posted}"`
  },
  buttons: async ui => {
    const found = await ui.findAll({ type: 'Button' })
    const r = await ui.press({ key: 'primary' })
    return `${found.length} Buttons; press primary -> ${JSON.stringify(r ?? null)}`
  },
  'input-select': async ui => {
    await ui.input({ key: 'name', text: 'typed', kind: 'change' })
    await ui.input({ key: 'name', text: 'typed' })
    await ui.select({ key: 'pick', value: 'c' })
    return 'input change + submit and select reached their handlers'
  },
  'markdown-links': async ui => {
    await ui.press({ key: 'md-links', link: { href: 'https://example.com/mine' } })
    return 'link press reached onLinkPress'
  },
}

const verdicts: Record<string, Record<string, Verdict>> = {}

const judge = async ($: any, id: string, surface: string, listed: boolean): Promise<Verdict> => {
  let ui: Ui
  try {
    ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: `lab-${id}`, viewport: VIEWPORT })
  } catch (err) {
    return { accepted: false, note: reasonOf(err) }
  }
  try {
    const threw = await ui.find({ type: 'Text', text: /^draw threw: / })
    if (threw) return { accepted: false, note: `the element refused its props as built: ${threw.text.slice('draw threw: '.length)}` }
    const notes = ['accepted']
    const absent = await ui.find({ type: 'Text', text: /^absent from the / })
    if (absent) notes.push(`${absent.text}; resolve's stand-in draws an empty column Box, no alt`)
    else notes.push(NOTES[id] ?? 'paint unverified')
    const probe = PROBES[id]
    if (probe && !absent) {
      try {
        notes.push(await probe(ui))
      } catch (err) {
        notes.push(`probe failed: ${reasonOf(err)}`)
      }
    }
    if (!listed) notes.push('(not a listed surface)')
    return { accepted: true, note: notes.join('; ') }
  } finally {
    await ui.unmount()
  }
}

test('every experiment on every surface', { timeoutMs: 120_000 }, async $ => {
  for (const x of experiments) {
    verdicts[x.id] = {}
    for (const surface of SURFACES) verdicts[x.id]![surface] = await judge($, x.id, surface, x.surfaces.includes(surface))
  }
  console.log(`VERDICTS ${JSON.stringify(verdicts)}`)
  expect(Object.keys(verdicts)).toHaveLength(experiments.length)
  // The gallery's skip list is what this run found the desktop refusing.
  const refused = experiments.filter(x => !verdicts[x.id]?.desktop?.accepted).map(x => x.id)
  expect([...refused].sort()).toEqual([...DESKTOP_REFUSED].sort())
  // Plain elements every surface lists are accepted everywhere.
  for (const surface of SURFACES) expect(verdicts['text-styles']?.[surface]?.accepted).toBe(true)
})

test('/lab opens the dashboard on its Lab tab; /lab <id> opens that experiment; an unknown id opens nothing', async ($, on) => {
  const opened = stubOpen(on)
  const states: { key: string; value: unknown }[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'tab') states.push({ key: e.key, value: e.value })
    return next(e)
  })
  await runLab($)
  expect(states).toEqual([{ key: 'tab', value: 'lab' }])
  expect(opened).toEqual([{ id: DASH, title: 'syn' }])
  await runLab($, 'svg-blur')
  await runLab($, 'gallery')
  const none = await runLab($, 'no-such-thing')
  expect(none.text).toContain('No experiment')
  expect(opened.map(o => o.id)).toEqual([DASH, 'lab-svg-blur', 'lab-gallery'])
})

/** A Button's key, as the kit hands it back. */
const keyOfButton = (b: any) => String(b?.key ?? b?.props?.key ?? '')

test('the index lists every experiment and a row opens its pane', async ($, on) => {
  const opened = stubOpen(on)
  for (const surface of SURFACES) {
    const ui: Ui = await mountIndex($, surface)
    // The tab row's Buttons are the dashboard's: count the index's own.
    const mine = (await ui.findAll({ type: 'Button' })).map(keyOfButton).filter((k: string) => k === 'gallery' || k.startsWith('open-'))
    expect(mine).toHaveLength(experiments.length + 1)
    await ui.press({ key: 'open-svg-blur' })
    await ui.press({ key: 'gallery' })
    await ui.unmount()
  }
  expect(opened.map(o => o.id).filter(id => id !== DASH)).toEqual(SURFACES.flatMap(() => ['lab-svg-blur', 'lab-gallery']))
})

test("an experiment's All experiments opens the dashboard on its Lab tab", async ($, on) => {
  const opened = stubOpen(on)
  const ui: Ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', props: PANE, requestId: 'lab-svg-blur', viewport: VIEWPORT })
  await ui.press({ key: 'index' })
  await ui.unmount()
  expect(opened).toEqual([{ id: DASH, title: 'syn' }])
  // The pane drawn now is the index, under the tab row.
  const index = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', props: { ...PANE, title: 'syn' }, requestId: DASH, viewport: VIEWPORT })
  expect(await index.find({ key: 'gallery' })).toBeDefined()
  await index.unmount()
})

test('the gallery draws every experiment the desktop accepts in one tree', async $ => {
  const ui: Ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', props: PANE, requestId: 'lab-gallery', viewport: VIEWPORT })
  const headers = await ui.findAll({ type: 'Text', text: / — / })
  expect(headers.map((t: any) => t.text.split(' — ')[0])).toEqual(galleryExperiments().map(x => x.id))
  expect(galleryExperiments()).toHaveLength(experiments.length - DESKTOP_REFUSED.length)
  await ui.unmount()
})

test('a Client post comes back as props', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: 'lab-client-post' })
    await ui.press({ key: 'ping' })
    expect(await ui.find({ type: 'Text', text: `pong 1 via ${surface}`, in: 'echo' })).toBeDefined()
    await ui.unmount()
  }
})

type Drawn = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
const kidsOf = (d: Drawn) => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity).filter((c): c is Drawn => !!c && typeof c === 'object')
const everyOf = (d: Drawn): Drawn[] => [d, ...kidsOf(d).flatMap(everyOf)]
const keyOf = (d: Drawn) => String(d.key ?? d.props?.key ?? '')

/**
 * The flow columns `requestId`'s pane draws at `bodyColumns` on `surface`, each with the keys in it that
 * match `block`, in order. The index (`DASH`) is the dashboard's pane on the Lab tab, opened with `/lab`.
 */
const flowAt = async ($: any, requestId: string, flow: string, block: RegExp, surface: string, bodyColumns: number) => {
  const ui: Ui =
    requestId === DASH
      ? await mountIndex($, surface, bodyColumns)
      : await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: { ...PANE, bodyColumns }, requestId, viewport: VIEWPORT })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()
  return everyOf(tree)
    .filter(d => d.type === 'Box' && new RegExp(`^${flow}-col-\\d+$`).test(keyOf(d)))
    .map(c => everyOf(c).map(keyOf).filter(k => block.test(k)))
}

test('on a wide desktop pane the index groups and the gallery sit in columns, each block once in order; narrow and on the terminal, one stack', { timeoutMs: 30_000 }, async ($, on) => {
  stubOpen(on)
  const groups = GROUPS.map(g => `group-${g}`)
  expect(await flowAt($, DASH, 'groups', /^group-/, 'desktop', 80)).toEqual([])
  expect(await flowAt($, DASH, 'groups', /^group-/, 'terminal', 180)).toEqual([])
  for (const [width, n] of [[120, 2], [180, 3]] as const) {
    const cols = await flowAt($, DASH, 'groups', /^group-/, 'desktop', width)
    expect(cols.length).toBe(n)
    expect(cols.flat()).toEqual(groups)
  }
  const ids = new Set(galleryExperiments().map(x => `x-${x.id}`))
  const block = { test: (k: string) => ids.has(k) } as RegExp
  expect(await flowAt($, 'lab-gallery', 'gallery', block, 'desktop', 80)).toEqual([])
  const gallery = await flowAt($, 'lab-gallery', 'gallery', block, 'desktop', 180)
  expect(gallery.length).toBe(3)
  expect(gallery.flat()).toEqual(galleryExperiments().map(x => `x-${x.id}`))
})

test("the footer's columns switch turns a wide index to one stack, and the setting stays in the mod's state for the next drawing", async ($, on) => {
  stubOpen(on)
  // What the lab writes to its `labColumns` state, as the host sees it.
  const writes: unknown[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'labColumns') writes.push(e.value)
    return next(e)
  })
  const mount = (): Promise<Ui> => mountIndex($, 'desktop', 120)
  const flowed = (tree: Drawn) => everyOf(tree).filter(d => d.type === 'Box' && /^groups-col-\d+$/.test(keyOf(d))).length
  const ui = await mount()
  expect(flowed((await ui.drawn()) as Drawn)).toBe(2)
  expect((await ui.find({ key: 'flow-toggle' }))?.props).toMatchObject({ label: 'columns' })
  await ui.press({ key: 'flow-toggle' })
  expect(writes).toEqual([false])
  await ui.unmount()
  // Drawn again (a reload keeps the mod's state): one stack, the switch dim.
  const again = await mount()
  expect(flowed((await again.drawn()) as Drawn)).toBe(0)
  expect((await again.find({ key: 'flow-toggle' }))?.props).toMatchObject({ label: 'single column', dimColor: true })
  await again.unmount()
})
