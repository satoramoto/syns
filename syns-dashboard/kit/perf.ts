/**
 * What a mod costs: how often each named thing ran, how long it took, and how
 * much of the last minute it spent. Each compiled mod gets its own copy of the
 * kit, so these are that mod's numbers. Recording never redraws: the footer
 * shows them as of the pane's latest draw, so measuring adds no load.
 *
 *   const done = perf.start('render'); …; done()
 *   await perf.time('git', () => run(...))
 *   perf.count('state write')
 */

const now = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now()

const WINDOW = 60_000

type Entry = { n: number; total: number; last: number; max: number; recent: Array<[at: number, ms: number]> }

export type PerfRow = {
  name: string
  /** Runs since the mod loaded. */
  n: number
  /** Runs in the last minute. */
  perMin: number
  /** Milliseconds per run, on average; 0 for counts. */
  avgMs: number
  lastMs: number
  maxMs: number
  /** Milliseconds spent in the last minute. */
  busyMs: number
}

export type PerfSnapshot = { sinceMs: number; rows: PerfRow[] }

export const createPerf = () => {
  const entries = new Map<string, Entry>()
  const loadedAt = Date.now()

  const record = (name: string, ms: number) => {
    const e = entries.get(name) ?? { n: 0, total: 0, last: 0, max: 0, recent: [] }
    const at = Date.now()
    e.n++
    e.total += ms
    e.last = ms
    e.max = Math.max(e.max, ms)
    e.recent.push([at, ms])
    // Keep only the window, so a long session doesn't grow this.
    while (e.recent.length && at - e.recent[0]![0] > WINDOW) e.recent.shift()
    entries.set(name, e)
  }

  /** Starts timing `name`; call what it returns when it's done. */
  const start = (name: string) => {
    const t0 = now()
    return () => record(name, now() - t0)
  }

  /** Times `fn`, sync or async, under `name`. */
  const time = <T>(name: string, fn: () => T): T => {
    const done = start(name)
    let out: T
    try {
      out = fn()
    } catch (err) {
      done()
      throw err
    }
    if (out instanceof Promise) return out.finally(done) as T
    done()
    return out
  }

  /** Counts one occurrence of `name`, with no time. */
  const count = (name: string) => record(name, 0)

  const snapshot = (): PerfSnapshot => {
    const at = Date.now()
    const rows = [...entries].map(([name, e]) => {
      const recent = e.recent.filter(([t]) => at - t <= WINDOW)
      return {
        name,
        n: e.n,
        perMin: recent.length,
        avgMs: e.n ? e.total / e.n : 0,
        lastMs: e.last,
        maxMs: e.max,
        busyMs: recent.reduce((s, [, ms]) => s + ms, 0),
      }
    })
    // What cost the most in the last minute first, then what ran most.
    rows.sort((a, b) => b.busyMs - a.busyMs || b.perMin - a.perMin)
    return { sinceMs: at - loadedAt, rows }
  }

  return { start, time, count, snapshot }
}

export type Perf = ReturnType<typeof createPerf>

/** Milliseconds, short: 0.4ms, 12ms, 1.2s. */
export const ms = (v: number): string => (v >= 1_000 ? `${(v / 1_000).toFixed(1)}s` : v >= 10 ? `${Math.round(v)}ms` : `${v.toFixed(1)}ms`)
