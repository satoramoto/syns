/** One thread under "What we're doing": a line of title and status, a line of next step. */
export type ThreadRow = {
  id: string
  /** The title up to its first colon (the rest is `about`). */
  title: string
  about: string
  priority: number
  status: string
  /** The first sentence of the thread's `next`. */
  next: string
}

/** One answered inbox item under "What you decided": the decision, not the question. */
export type Decision = {
  id: number
  /** The choice, or the note's first sentence when the choice was "Other". */
  text: string
  /** The question it answered, for context. */
  topic: string
  /** `answer.at` as stored (a date, or a date and time). */
  at: string
}

/** One open approval under "What needs you". */
export type Approval = { id: number; question: string }

/** What the pane draws from brain.json, read again whenever the file changes. */
export type BrainView = {
  path: string
  /** The file's mtime when read (ms since epoch). */
  mtime: number
  outcome: string
  /** Active threads, by priority, the top few. */
  threads: ThreadRow[]
  /** Active threads past the ones listed. */
  moreThreads: number
  /** Answered inbox items, newest first, the last few. */
  decided: Decision[]
  approvals: Approval[]
  /** Open inbox items that aren't approvals (questions, terms). */
  questions: number
  /** PRs named anywhere in the file, `owner/repo#n`. */
  prs: string[]
  /** brain.json's `updates`, each as one line of text, oldest first. */
  updates: string[]
  /** The single next step. */
  next: string
  /** Why nothing could be read (missing file, bad JSON). */
  error?: string
}

/** How a PR's checks stand: conflicting (won't merge) over the checks' rollup; empty when unknown or none. */
export type PrCi = 'passing' | 'failing' | 'pending' | 'conflicting' | ''

/** One of Ryan's open PRs, or a PR brain.json names, with its state from gh when it could be read. */
export type PrRow = {
  /** `owner/repo#n`. */
  ref: string
  /** `OPEN`, `MERGED`, `CLOSED`, or empty when gh couldn't tell. */
  state: string
  title: string
  /** The PR's page; empty when gh couldn't tell. */
  url: string
  ci: PrCi
}

/** Which list the band above the prompt has unfolded under its kinds, if any. */
export type BandOpen = 'updates' | null

/** A live agent from `$.agent.list()`. */
export type AgentRow = { id: string; description: string; type: string; status: string }

declare module 'claude-code' {
  interface PluginState {
    'syns-dashboard': {
      brain: BrainView | null
      prs: PrRow[]
      agents: AgentRow[]
      /** Each running agent's latest tool call, in words, by agent id. */
      doing: Record<string, string>
      /** Folded sections, by id. */
      collapsed: string[]
      /** Whether a wide app pane flows the sections into columns; on until flipped. */
      columns: boolean
      /** The band's unfolded list. */
      bandOpen: BandOpen
    }
  }
}
