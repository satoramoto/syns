/*
 * The branches a session works on, as the desktop app tracks them: each branch
 * or worktree the session starts, with its git state and its PR. This file
 * holds the parsing; register.tsx runs git and gh.
 */

/** Branches a Bash command starts, and where (relative to the command's directory when not absolute). */
export const startedBy = (command: string): { branch: string; path?: string }[] => {
  const found: { branch: string; path?: string }[] = []
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/)
    const at = words.indexOf('git')
    if (at < 0) continue
    const w = words.slice(at + 1).filter(x => x !== '-q' && x !== '--quiet')
    const flag = (names: string[]) => {
      const i = w.findIndex(x => names.includes(x))
      return i >= 0 ? w[i + 1] : undefined
    }
    if (w[0] === 'checkout' || w[0] === 'switch') {
      const branch = flag(['-b', '-B', '-c', '-C'])
      if (branch) found.push({ branch })
    } else if (w[0] === 'worktree' && w[1] === 'add') {
      const rest = w.slice(2)
      const branch = flag(['-b', '-B'])
      const positional = rest.filter((x, i) => !x.startsWith('-') && !['-b', '-B', '--reason'].includes(rest[i - 1] ?? ''))
      const path = positional[0]
      if (path) found.push({ branch: branch ?? positional[1] ?? path.split('/').pop()!, path: path.replace(/^["']|["']$/g, '') })
    }
  }
  return found
}

/** `git rev-list --left-right --count A...B`: behind, ahead. */
export const parseLeftRight = (text: string) => {
  const [behind = 0, ahead = 0] = text.trim().split(/\s+/).map(Number)
  return { behind, ahead }
}
