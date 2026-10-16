// Copies into syns' mods the code they share with satoramoto's other repos.
//
// The kit lives in zen (satoramoto/zen, `src/harness/claude-code/kit/`; how to build
// a mod with it: zen's docs/harness-claude-code.md). The engine refuses a plugin's
// imports from outside its own folder, so a mod carries its own copy of the kit
// (`<mod>/kit/`, committed), as awesome-claude's build puts one into each of its
// plugins. The mod imports it by relative path (`../kit/ui`), so nothing else is
// rewritten.
//
// The dashboard's Files tab is awesome-claude's filetree mod (`mods/filetree/`),
// drawn in the dashboard's pane: its hooks are copied into
// `syns-dashboard/hooks/filetree/` (committed; never edit them here, change them in
// awesome-claude and run the build again) with three rewrites the engine needs:
// `@kit/…` to the dashboard's kit, its state (`{ plugin: 'filetree', key: 'tree' }`)
// to the dashboard's (`filesTree`), since a plugin writes only its own and names it
// literally, and `../types` to the dashboard's contract. The contract must be one
// self-contained file, so filetree's value types are written into
// `syns-dashboard/types/index.d.ts` between the `filetree types` markers.
//
// Run it again to take a newer kit or filetree.
//
//   bun build.ts      from ../zen and ../awesome-claude (or $ZEN and $AWESOME, checkouts)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = import.meta.dir
const SOURCE = join(process.env.ZEN ?? join(ROOT, '..', 'zen'), 'src', 'harness', 'claude-code', 'kit')
const FILETREE = join(process.env.AWESOME ?? join(ROOT, '..', 'awesome-claude'), 'mods', 'filetree')
/** The mods that draw with the kit. */
const MODS = ['syns-dashboard']

for (const [dir, fix] of [
  [SOURCE, 'clone satoramoto/zen beside syns, or set ZEN to a zen checkout'],
  [FILETREE, 'clone satoramoto/awesome-claude beside syns, or set AWESOME to a checkout'],
]) {
  if (!existsSync(dir!)) {
    console.error(`no ${dir}: ${fix}`)
    process.exit(1)
  }
}

/** Writes `content` to `target` only when it differs; true when it wrote. */
const put = (target: string, content: string | Buffer) => {
  if (existsSync(target) && readFileSync(target).equals(Buffer.from(content))) return false
  writeFileSync(target, content)
  return true
}

/** Copies `names` from `from` into `out` through `map`, and removes what `out` has beyond them; the files changed. */
const mirror = (from: string, out: string, names: string[], map: (text: string) => string = t => t) => {
  mkdirSync(out, { recursive: true })
  let changed = 0
  for (const name of names) if (put(join(out, name), map(readFileSync(join(from, name), 'utf8')))) changed++
  for (const name of readdirSync(out)) {
    if (!names.includes(name)) {
      rmSync(join(out, name))
      changed++
    }
  }
  return changed
}

const code = (dir: string) => readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))

// ---- the kit ----

for (const mod of MODS) {
  const changed = mirror(SOURCE, join(ROOT, mod, 'kit'), code(SOURCE))
  console.log(`${mod}: kit from ${SOURCE} (${changed} changed)`)
}

// ---- filetree, the dashboard's Files tab ----

const DASH = join(ROOT, 'syns-dashboard')
/** `tree` to `filesTree`: the dashboard's state key for one of filetree's. */
const keyOf = (key: string) => `files${key[0]!.toUpperCase()}${key.slice(1)}`
const rewrite = (text: string) =>
  text
    .replace(/(from\s+|import\s*\(\s*)(['"])@kit\/([^'"]+)\2/g, (_, lead, q, rest) => `${lead}${q}../../kit/${rest}${q}`)
    .replace(/(from\s+)(['"])\.\.\/types\2/g, (_, lead, q) => `${lead}${q}../../types${q}`)
    .replace(/\{\s*plugin:\s*(['"])filetree\1,\s*key:\s*(['"])(\w+)\2\s*\}/g, (_, q, __, key) => `{ plugin: ${q}syns-dashboard${q}, key: ${q}${keyOf(key)}${q} }`)
const hooks = join(FILETREE, 'hooks')
let changed = mirror(hooks, join(DASH, 'hooks', 'filetree'), code(hooks), rewrite)
if (/plugin:\s*['"]filetree['"]/.test(readdirSync(join(DASH, 'hooks', 'filetree')).map(n => readFileSync(join(DASH, 'hooks', 'filetree', n), 'utf8')).join('\n'))) {
  console.error('filetree names its state in a way build.ts does not rewrite: update its rewrite')
  process.exit(1)
}

// Its value types: everything in its contract before the PluginState declaration.
const types = readFileSync(join(FILETREE, 'types', 'index.d.ts'), 'utf8')
const cut = types.indexOf('declare module')
if (cut < 0) {
  console.error(`no PluginState declaration in ${join(FILETREE, 'types', 'index.d.ts')}`)
  process.exit(1)
}
const contract = join(DASH, 'types', 'index.d.ts')
const START = '// ---- filetree types (bun build.ts writes these, from awesome-claude mods/filetree/types/index.d.ts) ----\n'
const END = '// ---- end filetree types ----\n'
const was = readFileSync(contract, 'utf8')
const a = was.indexOf(START)
const b = was.indexOf(END)
if (a < 0 || b < a) {
  console.error(`no filetree types markers in ${contract}`)
  process.exit(1)
}
if (put(contract, `${was.slice(0, a + START.length)}\n${types.slice(0, cut).trim()}\n\n${was.slice(b)}`)) changed++
console.log(`syns-dashboard: filetree from ${FILETREE} (${changed} changed)`)
