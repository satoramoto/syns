// What the analysis scripts share about Claude Code transcripts: where they
// are (`~/.claude/projects/<slug>/<sessionId>.jsonl`, with each session's
// subagents under `<slug>/<sessionId>/subagents/agent-<id>.jsonl`), how a
// cwd names a repo, and how the person's words are taken out of a prompt.

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOME = homedir()
export const PROJECTS_DIR = join(HOME, '.claude', 'projects')

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Every `.jsonl` (or other `suffix`) file under `dir`, in sorted path order. */
export const walk = (dir: string, suffix: string, out: string[] = []): string[] => {
  let entries: { name: string; dir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map(e => ({ name: e.name, dir: e.isDirectory() }))
  } catch {
    return out
  }
  for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
    const path = join(dir, e.name)
    if (e.dir) walk(path, suffix, out)
    else if (e.name.endsWith(suffix)) out.push(path)
  }
  return out
}

export const sortedDir = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

export const mtime = (path: string): number => {
  try {
    const s = statSync(path)
    return s.isFile() ? s.mtimeMs : -1
  } catch {
    return -1
  }
}

/** `owner/name` for a cwd under `~/Code/`, `codex desktop` for Codex Desktop's folders, else its last two segments (as the Tasks tab names them). */
export const repoOf = (cwd: string): string => {
  if (!cwd) return '(unknown)'
  if (cwd.startsWith(`${HOME}/Documents/Codex/`)) return 'codex desktop'
  const inCode = cwd.startsWith(`${HOME}/Code/`)
  const parts = (inCode ? cwd.slice(HOME.length + 6) : cwd).split('/').filter(Boolean)
  return (inCode ? parts.slice(0, 2) : parts.slice(-2)).join('/') || cwd
}

/** The person's words in a Claude prompt: a slash command's name and arguments kept, the app's tagged blocks left out. */
export const cleanClaude = (raw: string): string => {
  // An artifact comment arrives wrapped in the app's instructions; the person's words are the quoted lines.
  if (raw.startsWith('[Artifact comment sent to Claude]')) {
    const quote = /=== BEGIN ARTIFACT COMMENT \w+ ===\n([\s\S]*?)\n=== END ARTIFACT COMMENT/.exec(raw)?.[1] ?? ''
    return quote.replace(/^> ?/gm, '').trim()
  }
  if (/^(Another Claude session sent a message:|\[Subagent )/.test(raw)) return ''
  const command = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/.exec(raw)?.[1] ?? ''
  const text = raw
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, ' $1 ')
    .replace(/<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<\/?[a-zA-Z][\w-]*\b[^>]*>/g, ' ')
    .trim()
  return `${command} ${text}`.trim()
}
