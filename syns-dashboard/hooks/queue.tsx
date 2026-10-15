// The band above the prompt: how deep Claude's two queues are, read from brain.json.
// Questions are the open inbox items; updates are brain.json's `updates` list.
// Pure: register.tsx reads the file (the engine follows $ only within one file).

/** The band's line for brain.json's text. */
export function queueText(text: string): string {
  try {
    const b = JSON.parse(text) as { inbox?: { status?: string }[]; updates?: unknown[] }
    const questions = (b.inbox ?? []).filter(i => (i.status ?? 'open') === 'open').length
    const updates = (b.updates ?? []).length
    return `Questions: ${questions} · Updates: ${updates}`
  } catch {
    return 'brain.json unreadable'
  }
}
