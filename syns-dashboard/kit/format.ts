const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''))

/** Token counts: 950, 1.2k, 84k, 1M. */
export const tokens = (n: number): string => {
  if (n >= 999_500) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}k`
  return String(Math.round(n))
}

/** A duration to the second: 12s, 3m 05s, 2h 05m. */
export const duration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1_000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** A duration at a glance: 47m, 2h05, 3d4h. */
export const short = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/** How long ago, coarsely, as GitHub lists things: 5m, 3h, 2d, 3w, 4mo, 2y. */
export const ago = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 14) return `${d}d`
  if (d < 60) return `${Math.floor(d / 7)}w`
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

/** US dollars: $1.50, $123. */
/** Bytes, short: 812, 41K, 3.2M, 16G. */
export const bytes = (n: number): string => {
  const units = ['', 'k', 'M', 'G', 'T']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)}${units[i]}`
}

export const money =(usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

/** `value` as a whole percent of `max`, clamped: the desktop takes whole percentages only. */
export const pct = (value: number, max: number) => `${Math.round(Math.max(0, Math.min(100, (value / Math.max(max, 1)) * 100)))}%`

/**
 * `text` cut in the middle to at most `cells` characters, the end kept: a path
 * keeps its first segment and as many whole segments from its end as fit
 * (`src/…/hooks/view.tsx`), then `…/view.tsx`, then the end of its name; other
 * text keeps its start and end around `…`. Text that fits comes back as is.
 */
export const middle = (text: string, cells: number): string => {
  const chars = [...text]
  const n = Math.max(0, Math.floor(cells))
  if (chars.length <= n) return text
  if (n <= 1) return n === 1 ? '…' : ''
  const parts = text.split('/')
  if (parts.length >= 2) {
    const len = (s: string) => [...s].length
    const head = parts[0]!
    const tail: string[] = [parts[parts.length - 1]!]
    // As many whole segments from the end as fit after `head/…/`.
    for (let i = parts.length - 2; i > 0; i--) {
      const next = [parts[i]!, ...tail].join('/')
      if (len(`${head}/…/${next}`) > n) break
      tail.unshift(parts[i]!)
    }
    const kept = tail.join('/')
    if (len(`${head}/…/${kept}`) <= n) return `${head}/…/${kept}`
    if (len(`…/${kept}`) <= n) return `…/${kept}`
    // Not even the name fits: the end of the name.
    const name = [...kept]
    return `…${name.slice(name.length - (n - 1)).join('')}`
  }
  // Plain text: a little more of the start than the end.
  const front = Math.ceil((n - 1) / 2)
  const back = n - 1 - front
  return `${chars.slice(0, front).join('')}…${back ? chars.slice(chars.length - back).join('') : ''}`
}

/** The last path segment. */
export const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
