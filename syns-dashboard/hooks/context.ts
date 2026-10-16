import type { SessionContextBreakdown } from 'claude-code'

import { C, INK, RAMP, TRACK } from '../kit/tokens'
import type { Part } from '../kit/ui'
import type { ContextSnap } from '../types'

/*
 * The context bar, as awesome-claude's overview mod draws it: the used window
 * grouped into four (what the system brings, what MCP brings, the person's
 * setup, the conversation), then the free room up to compaction, then the
 * buffer past it. Pure: register.tsx reads the breakdown, band.tsx draws it.
 */

/** The breakdown as the band keeps it: plain figures, no colours (the kit's tokens are filled at draw time). */
export const toSnap = (b: SessionContextBreakdown): ContextSnap => ({
  total: b.totalTokens,
  max: b.rawMaxTokens,
  percent: b.percentage,
  ...(b.isAutoCompactEnabled && b.autoCompactThreshold ? { compactAt: b.autoCompactThreshold } : {}),
  used: b.categories.filter(c => c.kind === 'used').map(c => ({ name: c.name, tokens: c.tokens })),
})

/** A category's group and colour: the fixed overhead in shades of slate, messages in blue. */
const groupOf = (name: string): { name: string; color: string } => {
  const map: Record<string, [string, () => string]> = {
    'System prompt': ['System', () => RAMP.slate[0]],
    'System tools': ['System', () => RAMP.slate[0]],
    'MCP tools': ['MCP', () => RAMP.slate[1]],
    'MCP server instructions': ['MCP', () => RAMP.slate[1]],
    'Custom agents': ['Memory', () => RAMP.slate[2]],
    'Memory files': ['Memory', () => RAMP.slate[2]],
    Skills: ['Memory', () => RAMP.slate[2]],
    Messages: ['Messages', () => C.blue],
  }
  const hit = map[name]
  return hit ? { name: hit[0], color: hit[1]() } : { name, color: INK }
}

/** The desktop's free room, a step brighter than the empty track, and its buffer, amber made faint (overview's). */
const FREE = 'rgba(128,128,128,0.34)'
const BUFFER = 'rgba(227,163,59,0.32)'

/** The bar's parts: the used groups, the free room up to compaction, the buffer past it (amber). */
export const contextBar = (snap: ContextSnap, terminal: boolean): Part[] => {
  const parts: Part[] = []
  for (const s of snap.used) {
    if (s.tokens <= 0) continue
    const g = groupOf(s.name)
    const at = parts.find(p => p.label === g.name)
    if (at) at.value += s.tokens
    else parts.push({ value: s.tokens, color: g.color, label: g.name })
  }
  const free = Math.max(0, (snap.compactAt ?? snap.max) - snap.total)
  const buffer = snap.compactAt && snap.max > snap.compactAt ? snap.max - snap.compactAt : 0
  if (free > 0) parts.push({ value: free, color: terminal ? TRACK : FREE, label: 'Free', room: true })
  if (buffer > 0) parts.push({ value: buffer, color: terminal ? C.warn : BUFFER, label: 'Buffer', room: true })
  return parts
}
