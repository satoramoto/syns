// Copies zen's Claude Code kit into syns' mods.
//
// The kit lives in zen (satoramoto/zen, `src/harness/claude-code/kit/`; how to build
// a mod with it: zen's docs/harness-claude-code.md). The engine refuses a plugin's
// imports from outside its own folder, so a mod carries its own copy of the kit
// (`<mod>/kit/`, committed). The mod imports it by relative path (`../kit/ui`), so
// nothing else is rewritten.
//
// The dashboard's tabs (Session, Files, Issues, Launcher, Lab) and blast-radius were
// awesome-claude's mods; their code is syns source now, in
// `syns-dashboard/hooks/<mod>/`, edited in place. This build no longer reads
// awesome-claude.
//
// Run it again to take a newer kit.
//
//   bun build.ts      from ../zen (or $ZEN, a zen checkout)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = import.meta.dir
const SOURCE = join(process.env.ZEN ?? join(ROOT, '..', 'zen'), 'src', 'harness', 'claude-code', 'kit')
/** The mods that draw with the kit. */
const MODS = ['syns-dashboard']

if (!existsSync(SOURCE)) {
  console.error(`no ${SOURCE}: clone satoramoto/zen beside syns, or set ZEN to a zen checkout`)
  process.exit(1)
}

/** Writes `content` to `target` only when it differs; true when it wrote. */
const put = (target: string, content: string | Buffer) => {
  if (existsSync(target) && readFileSync(target).equals(Buffer.from(content))) return false
  writeFileSync(target, content)
  return true
}

/** Copies `names` from `from` into `out`, and removes what `out` has beyond them; the files changed. */
const mirror = (from: string, out: string, names: string[]) => {
  mkdirSync(out, { recursive: true })
  let changed = 0
  for (const name of names) if (put(join(out, name), readFileSync(join(from, name), 'utf8'))) changed++
  for (const name of readdirSync(out)) {
    if (!names.includes(name)) {
      rmSync(join(out, name))
      changed++
    }
  }
  return changed
}

const code = (dir: string) => readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))

for (const mod of MODS) {
  const changed = mirror(SOURCE, join(ROOT, mod, 'kit'), code(SOURCE))
  console.log(`${mod}: kit from ${SOURCE} (${changed} changed)`)
}
