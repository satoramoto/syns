// Copies awesome-claude's shared kit into each syns mod that draws with it.
//
// The engine refuses a plugin's imports from outside its own folder, so a mod
// carries its own copy of the kit (`<mod>/kit/`, committed), as awesome-claude's
// build puts one into each of its plugins. The mod imports it by relative path
// (`../kit/ui`), so nothing else is rewritten. Run it again to take a newer kit.
//
//   bun build.ts      copy the kit from ../awesome-claude/kit (or $AWESOME_CLAUDE/kit)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = import.meta.dir
const SOURCE = join(process.env.AWESOME_CLAUDE ?? join(ROOT, '..', 'awesome-claude'), 'kit')
/** The mods that draw with the kit. */
const MODS = ['syns-dashboard']

if (!existsSync(SOURCE)) {
  console.error(`no kit at ${SOURCE}: clone awesome-claude beside syns, or set AWESOME_CLAUDE`)
  process.exit(1)
}

// The kit's own tests stay in awesome-claude, as its build leaves them out.
const files = readdirSync(SOURCE).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))

for (const mod of MODS) {
  const out = join(ROOT, mod, 'kit')
  mkdirSync(out, { recursive: true })
  let changed = 0
  for (const name of files) {
    const content = readFileSync(join(SOURCE, name))
    const target = join(out, name)
    if (existsSync(target) && readFileSync(target).equals(content)) continue
    writeFileSync(target, content)
    changed++
  }
  // Files the kit no longer has.
  for (const name of readdirSync(out)) {
    if (!files.includes(name)) {
      rmSync(join(out, name))
      changed++
    }
  }
  console.log(`${mod}: kit from ${SOURCE} (${changed} changed)`)
}
