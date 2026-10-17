/** One thread under "What we're doing": a line of title and status, a line of next step. */
export type ThreadRow = {
  id: string
  /** The title up to its first colon (the rest is `about`). */
  title: string
  about: string
  /** The thread's priority (1 first); 0 for none. */
  priority: number
  status: string
  /** `priority`: worked on now, in priority order; `next`: waiting its turn, drawn dimmer. */
  tier: 'priority' | 'next'
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

/** brain.json's `ignored`: the repos (`owner/name`, their future PRs too) and PRs (`owner/repo#n`) Pull requests leaves out. */
export type Ignored = { repos: string[]; prs: string[] }

/** What the pane draws from brain.json, read again whenever the file changes. */
export type BrainView = {
  path: string
  /** The file's mtime when read (ms since epoch). */
  mtime: number
  outcome: string
  /** Prioritised threads in priority order, then the few `next` ones. */
  threads: ThreadRow[]
  /** `next` threads past the ones listed. */
  moreThreads: number
  /** Threads marked `decided`: counted, not listed. */
  decidedThreads: number
  /** Answered inbox items, newest first, the last few. */
  decided: Decision[]
  approvals: Approval[]
  /** Open inbox items that aren't approvals (questions, terms). */
  questions: number
  /** PRs named anywhere in the file but `ignored`, `owner/repo#n`. */
  prs: string[]
  /** brain.json's `ignored`: what Pull requests leaves out. */
  ignored: Ignored
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

/** The context window as the band's bar draws it, from `$.session.usage({ breakdown })`. */
export type ContextSnap = {
  total: number
  max: number
  percent: number
  /** Where auto-compaction starts, when it's on. */
  compactAt?: number
  /** The used categories, as `/context` names them. */
  used: { name: string; tokens: number }[]
}

/** A live agent from `$.agent.list()`. */
export type AgentRow = { id: string; description: string; type: string; status: string }

/** The pane's tabs: Overview (the sections above) and Files (filetree's tree of the session's cwd). */
export type DashTab = 'overview' | 'files'

// ---- filetree types (bun build.ts writes these, from awesome-claude mods/filetree/types/index.d.ts) ----

export type FileNode = {
  id: string
  parent: string
  name: string
  kind: 'dir' | 'file' | 'link'
  hidden: boolean
  mtime: number
  size: number
  loaded: boolean
}

export type Branch = {
  head: string
  upstream: string
  /** The upstream remote's host (`github.com`), for its icon; empty when untracked or unknown. */
  host: string
  ahead: number
  behind: number
}

export type Activity = {
  id: number
  kind: string
  label: string
  state: 'running' | 'done' | 'failed'
  detail: string
  at: number
  tone: string
  nerd: string
  plain: string
}

export type FileTree = {
  root: string
  nodes: FileNode[]
  expanded: string[]
  cursor: string
  selected: string
  query: string
  showHidden: boolean
  showSize: boolean
  dirSizes: Record<string, number>
  git: Record<string, string>
  diff: Record<string, [number, number]>
  ignored: string[]
  untrackedDirs: string[]
  top: string
  prefix: string
  branch: Branch | null
  counts: Record<string, [number, number, number]>
  flash: string[]
  flashDim: string[]
  flashOn: boolean
  flashTones: Record<string, string>
  scroll: number | null
  preview: string
  previewTop: number
}

// ---- end filetree types ----

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
      /** Whether Pull requests lists its ignored repos and PRs (the header's "N ignored" pressed). */
      ignoredOpen: boolean
      /** The band's unfolded list. */
      bandOpen: BandOpen
      /** The context window, for the band's bar; null before the first measurement. */
      context: ContextSnap | null
      /** The pane's tab shown; Overview until another is chosen. */
      tab: DashTab
      /** The Files tab's tree: filetree's `tree`, kept under the dashboard's name (see build.ts). */
      filesTree: FileTree
      /** Claude's git steps the Files tab's footer shows: filetree's `activity`. */
      filesActivity: Activity[]
    }
  }
}
