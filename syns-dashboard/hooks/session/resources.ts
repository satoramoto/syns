import type { Resources } from '../../types'

/*
 * The session's share of the machine, from one cheap shell command (ps, sysctl,
 * ioreg, netstat; a few milliseconds): the session's Claude Code process (the
 * nearest ancestor named `claude`), its whole process tree's CPU and memory,
 * and the system's CPU, memory, disk and network. The tree's own network comes
 * from `nettop`, which always takes 5 s (but almost no CPU), on its own. Rates
 * are deltas between samples. macOS only. register.tsx runs the commands; this
 * file parses.
 */

/**
 * The sample command. Measured CPU per run: ps 0.02 s (0.04 s with names, so
 * names only on the first run, to find the session's process), iostat, netstat
 * and sysctl a few ms each.
 */
export const resourcesSh = () => [
  'sh',
  '-c',
  `echo $PPID; ps -A -o pid=,ppid=,%cpu=,rss=${root === null ? ',comm=' : ''}; echo @; sysctl -n hw.ncpu hw.memsize; echo @; ` +
    'iostat -Id -c 1; echo @; netstat -ib',
]

/** The session's Claude Code process, found once. */
let root: number | null = null

/** The tree's network, one nettop sample: per process, bytes in and out so far. */
export const NETTOP = ['nettop', '-P', '-L', '1', '-x', '-J', 'bytes_in,bytes_out']

/** Whether to read the tree's own network with nettop (about 0.015 s of CPU a run). */
export const NET_PER_PROCESS = true

type Counters = { pids: number[]; cores: number; cpu: number; cpuAll: number; mem: number; memAll: number; diskAll: number; netAll: number }

const parse = (out: string): Counters => {
  const [head = '', sys = '', io = '', nets = ''] = out.split('\n@\n')
  const lines = head.split('\n')
  const self = Number(lines[0])
  const rows = new Map<number, { ppid: number; cpu: number; rss: number; name: string }>()
  for (const line of lines.slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s*(.*)$/.exec(line)
    if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), cpu: Number(m[3]), rss: Number(m[4]), name: m[5]!.split('/').pop()! })
  }
  // The session's process: the nearest ancestor named `claude`, else the shell's parent.
  if (root === null || !rows.has(root)) {
    root = self
    for (let pid = self; rows.has(pid); pid = rows.get(pid)!.ppid) {
      if (rows.get(pid)!.name === 'claude') {
        root = pid
        break
      }
    }
  }
  const kids = new Map<number, number[]>()
  for (const [pid, r] of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), pid])
  const pids: number[] = []
  const todo = [root!]
  while (todo.length) {
    const pid = todo.pop()!
    pids.push(pid)
    todo.push(...(kids.get(pid) ?? []))
  }
  const [cores = 1, memAll = 0] = sys.trim().split('\n').map(Number)
  let netAll = 0
  const seen = new Set<string>()
  for (const line of nets.split('\n').slice(1)) {
    const p = line.trim().split(/\s+/)
    if (p.length >= 10 && p[2]!.startsWith('<Link') && !p[0]!.startsWith('lo') && !seen.has(p[0]!)) {
      seen.add(p[0]!)
      netAll += Number(p[6]) + Number(p[9])
    }
  }
  const sum = (f: (r: { cpu: number; rss: number }) => number, ids: Iterable<number>) => [...ids].reduce((n, id) => n + (rows.has(id) ? f(rows.get(id)!) : 0), 0)
  return {
    pids,
    cores,
    cpu: sum(r => r.cpu, pids),
    cpuAll: sum(r => r.cpu, rows.keys()),
    mem: sum(r => r.rss, pids) * 1024,
    memAll,
    // iostat -I: per disk, KB/t, transfers and MB so far; the MB is every third figure.
    diskAll: (io.trim().split('\n').pop() ?? '')
      .trim()
      .split(/\s+/)
      .filter((_, i) => i % 3 === 2)
      .reduce((n, mb) => n + Number(mb) * 1024 * 1024, 0),
    netAll,
  }
}

let prev: { at: number; c: Counters } | null = null
let netPrev: { at: number; bytes: number } | null = null
let net: number | null = null
let treePids: number[] = []

/** Turns one sample into a Resources; null on the first. */
export const toResources = (stdout: string, at: number): Resources | null => {
  const c = parse(stdout)
  treePids = c.pids
  const before = prev
  prev = { at, c }
  if (!before) return null
  const secs = Math.max(0.5, (at - before.at) / 1000)
  const rate = (a: number, b: number) => Math.max(0, (a - b) / secs)
  const allCores = c.cores * 100
  return {
    procs: c.pids.length,
    cpu: (c.cpu / allCores) * 100,
    cpuAll: Math.min(100, (c.cpuAll / allCores) * 100),
    mem: c.mem,
    memAll: c.memAll,
    diskAll: rate(c.diskAll, before.c.diskAll),
    net,
    netAll: rate(c.netAll, before.c.netAll),
  }
}

/** Folds one nettop sample into the tree's network rate. */
export const takeNettop = (stdout: string, at: number) => {
  const mine = new Set(treePids)
  let bytes = 0
  for (const line of stdout.split('\n')) {
    const m = /\.(\d+),(\d+),(\d+),?$/.exec(line)
    if (m && mine.has(Number(m[1]))) bytes += Number(m[2]) + Number(m[3])
  }
  if (netPrev) net = Math.max(0, (bytes - netPrev.bytes) / Math.max(0.5, (at - netPrev.at) / 1000))
  netPrev = { at, bytes }
}
