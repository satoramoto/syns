#!/usr/bin/env node
// Scans ~/Code/<org>/<repo> and writes ~/.syns/repos.json (+ repos.js next to the explorer, for file:// use).
// Tags, purposes and hand-written deps come from ~/.syns/repo-tags.json (the sidecar; never overwritten).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = homedir()
const CODE = join(HOME, 'Code')
const OUT = join(HOME, '.syns', 'repos.json')
const SIDECAR = join(HOME, '.syns', 'repo-tags.json')
const JS_OUT = join(dirname(fileURLToPath(import.meta.url)), 'repos.js')

const git = (cwd, ...args) => {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return '' }
}
const dirs = p => readdirSync(p).filter(n => !n.startsWith('.') && statSync(join(p, n)).isDirectory())
const json = p => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

const checkout = path => ({
  path,
  branch: git(path, 'branch', '--show-current') || '(detached)',
  dirty: git(path, 'status', '--porcelain').split('\n').filter(Boolean).length,
})

const sidecar = json(SIDECAR) ?? {}
const repos = []

for (const org of dirs(CODE)) {
  for (const name of dirs(join(CODE, org))) {
    const path = join(CODE, org, name)
    // Main checkouts have a .git directory; worktree checkouts have a .git file and are folded in below.
    if (!existsSync(join(path, '.git')) || !statSync(join(path, '.git')).isDirectory()) continue

    const main = checkout(path)
    const worktrees = git(path, 'worktree', 'list', '--porcelain').split('\n\n').map(b => b.split('\n')).flatMap(lines => {
      const wt = lines.find(l => l.startsWith('worktree '))?.slice(9)
      if (!wt || wt === path) return []
      return [checkout(wt)]
    })

    const manifests = ['package.json', 'Cargo.toml', 'Gemfile', 'pyproject.toml', 'go.mod'].filter(f => existsSync(join(path, f)))
    const pkg = json(join(path, 'package.json'))
    const lang = manifests.includes('Gemfile') ? 'rails' : manifests.includes('pyproject.toml') ? 'py'
      : manifests.includes('Cargo.toml') ? 'rust' : manifests.includes('package.json') ? 'ts'
      : manifests.includes('go.mod') ? 'go' : existsSync(join(path, 'README.md')) ? 'md' : '—'

    const last = git(path, 'log', '-1', '--format=%cI')
    repos.push({
      id: `${org}/${name}`, org, name, path,
      remote: git(path, 'remote', 'get-url', 'origin').replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''),
      branch: main.branch, dirty: main.dirty, last, lang, manifests,
      package: pkg?.name ?? null,
      worktrees,
      _npmDeps: Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies }),
    })
  }
}

// Resolve npm dependencies between scanned repos by package name, then merge in the sidecar.
const byPackage = new Map(repos.filter(r => r.package).map(r => [r.package, r.id]))
for (const r of repos) {
  const auto = r._npmDeps.map(d => byPackage.get(d)).filter(d => d && d !== r.id)
  delete r._npmDeps
  const meta = sidecar[r.id] ?? {}
  r.tags = meta.tags ?? []
  r.purpose = meta.purpose ?? ''
  r.deps = [...new Set([...auto, ...(meta.deps ?? [])])]
  r.depsAuto = auto
}

const doc = { scanned: new Date().toISOString(), root: CODE, repos }
writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n')
writeFileSync(JS_OUT, `window.REPOS=${JSON.stringify(doc)};\n`)
console.log(`${repos.length} repos, ${repos.reduce((n, r) => n + r.worktrees.length, 0)} worktrees -> ${OUT}`)
