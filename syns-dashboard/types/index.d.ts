/** One pod under "What we're doing": a line of title and status, a line of next step. */
export type PodRow = {
  id: string
  /** The title up to its first colon (the rest is `about`). */
  title: string
  about: string
  /** The pod's priority (1 first); 0 for none. */
  priority: number
  status: string
  /** `priority`: worked on now, in priority order; `next`: waiting its turn, drawn dimmer. */
  tier: 'priority' | 'next'
  /** The first sentence of the pod's `next`. */
  next: string
}

/** One answered inbox item under "What you decided": the question as a one-line title, the decision called out under it, the rest behind a fold. */
export type Decision = {
  id: number
  /** The question in one line: its `title` or `topic` when the item has one, else its first sentence. */
  title: string
  /** The choice, or the note's first sentence when the choice was "Other". */
  text: string
  /** The question it answered, in full. */
  topic: string
  /** The answer's note, in full; empty when none. */
  note: string
  /** Why: the chosen option's description, when the choice was one of the options; empty otherwise. */
  reason: string
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
  /** Prioritised pods in priority order, then the few `next` ones. */
  pods: PodRow[]
  /** `next` pods past the ones listed. */
  morePods: number
  /** Pods marked `decided`: counted, not listed. */
  decidedPods: number
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
  /** A draft PR (gh's `isDraft`). */
  draft: boolean
  /** The repo's default merge method for the viewer (`MERGE`, `SQUASH`, `REBASE`); empty when unknown. */
  method: string
  /** Auto-merge is on (gh's `autoMergeRequest` is set). */
  auto: boolean
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

/** One of an epic's `outcomes`: what it says, how it's settled and the first proof that settles it. */
export type OutcomeRow = {
  id: string
  text: string
  /** How it's settled: `review`, `test`, `measurement`, … */
  by: string
  /** `proven`, `refuted`, `open` or `dropped`; anything else reads as open. */
  status: 'proven' | 'refuted' | 'open' | 'dropped'
  /** Its `proof`: the plan for the proof that will settle it; empty when none. */
  plan: string
  /** What its first proof opens: a page's or PR's URL, or a file's path (may start with `~`); empty when it has no proofs. */
  proof: string
}

/** One `~/.syns/epics/<id>/epic.json` under Epics: its status, phase, outcomes and open questions. */
export type EpicRow = {
  id: string
  rev: number
  /** `draft`, `review`, `approved`, `active`, `done`, `rejected` or `dropped`, lower-cased; empty when unset. */
  status: string
  /** `proposal` (draft, review), `delivery` (approved, active), else the status itself. */
  phase: string
  /** The goal's first sentence. */
  goal: string
  /** Its outcomes, in order. */
  outcomes: OutcomeRow[]
  /** Its `questions` still open in brain.json's inbox. */
  questions: number
  /** The first `evidence` entry of kind `page`: the epic's page; empty when none. */
  page: string
  /** Why the file couldn't be read (bad JSON). */
  error?: string
}

/**
 * The pane's tabs: Overview (the sections above), Session (the session's context,
 * limits, activity, cost and git), Files (filetree's tree of the session's cwd),
 * Tasks (every session's task list, by repo), Issues (the repo's open GitHub
 * issues), Launcher (launch.json's dev servers), Analysis (the focus analyzer's
 * last run) and Lab (the engine experiments, for mod authors).
 */
export type DashTab = 'overview' | 'session' | 'tasks' | 'files' | 'issues' | 'launcher' | 'analysis' | 'lab'

// ---- filetree types (the Files tab, hooks/filetree/) ----

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

// ---- session types (the Session tab, hooks/session/: awesome-claude's overview mod) ----

/** One category of the window, as /context lists it; `kind` as the engine stamps it. */
export type Segment = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

/** One line item under a category (a memory file, an MCP server, a skill, an agent). */
export type Item = { label: string; tokens: number }

/** The breakdown, slimmed to what the tab draws. */
export type Snapshot = {
  model: string
  total: number
  max: number
  percent: number
  compactAt?: number
  segments: Segment[]
  memory: Item[]
  mcp: Item[]
  skills: Item[]
  agents: Item[]
}

/** One changed path from `git status --porcelain=v2`. */
export type GitFile = {
  path: string
  kind: 'conflict' | 'untracked' | 'added' | 'deleted' | 'renamed' | 'modified'
  /** Only the index has the change (nothing left unstaged). */
  staged: boolean
}

/** The session's repo as the git section draws it. */
export type GitInfo = {
  ok: true
  /** `git rev-parse --show-toplevel` of the session cwd. */
  root: string
  repo: string
  /** Branch name, or the short commit when detached. */
  branch: string
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
  worktree: { name: string; path: string; linked: boolean; count: number }
  staged: number
  modified: number
  untracked: number
  conflicted: number
  insertions: number
  deletions: number
  /** The first few changed paths. */
  files: GitFile[]
  /** Changed paths in all, beyond `files` too. */
  fileCount: number
  /** Set when the last read failed and these are the last-good figures kept through it: why it failed. Absent after a good read. */
  failed?: string
  /** With `failed`: when the figures were last read good (ms since epoch). */
  at?: number
}

/** Why there is no git section: not a repo, git missing. */
export type GitNote = { ok: false; note: string }

/** One pull request for the git section. */
export type GitPr = {
  number: number
  title: string
  url: string
  /** `OPEN`, `MERGED` or `CLOSED`. */
  state: string
  isDraft: boolean
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` or empty. */
  review: string
  checks: { passed: number; failed: number; pending: number }
  /** Names of the failing checks. */
  failing: string[]
  /** The PR's head is the current branch. */
  current: boolean
  /** GitHub can't merge it for conflicts with its base (`mergeable` is `CONFLICTING`). */
  conflicting?: boolean
}

/** The cached `gh` result, refreshed on a slower timer. */
export type GhInfo = {
  /** The repo root it was fetched for. */
  root: string
  prs: GitPr[]
  /** Why there are no PRs to show: gh missing, unauthenticated, no remote. */
  note?: string
  /** Set when the last read failed and `prs` are the last-good ones kept through it: why it failed. Absent after a good read. */
  failed?: string
  /** When `prs` were read (ms since epoch); with `failed`, when they were last read good. */
  at: number
}

/** The workspaces' shared `gh pr list` read: whether the last one failed, and when the PRs were last read good. */
export type WorkspacesGh = { failed?: string; at: number }

/** One account rate-limit window as the API last reported it. */
export type Limit = {
  /** `five_hour`, `seven_day`, a gateway's `spend_limit`, or another window the API names. */
  kind: string
  /** 0 to 100; past 100 on an exceeded spend limit. */
  percent: number
  /** ISO 8601 time the window resets. */
  resetsAt?: string
}

/** One tool's calls this session, and how many of them errored. */
export type ToolCount = { n: number; err: number }

/** One main-loop turn: its time, its tokens, and the tool calls made during it (absent on older points). */
export type TurnPoint = {
  ms: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  calls?: number
  /** The turn's tool calls by tool name (absent on older points). */
  tools?: Record<string, number>
}

/** What the session has done, as the hooks saw it (the overview mod's `Activity`; filetree's `Activity` is another thing). */
export type SessionActivity = {
  /** When the session's figures count from (ms since epoch); absent until the first usage read. */
  startedAt?: number
  /** US dollars so far; absent where the host keeps no cost ledger. */
  cost?: number
  /** Main-loop turns finished. */
  turns: number
  /** Tool calls since the last turn finished, for the next TurnPoint. */
  callsThisTurn?: number
  /** Those calls by tool name. */
  turnTools?: Record<string, number>
  /** Calls per tool name, subagents' included. */
  tools: Record<string, ToolCount>
  /** Paths Edit, Write, MultiEdit and NotebookEdit touched, each once. */
  files: string[]
  /** The last main-loop turns, oldest first. */
  turnLog: TurnPoint[]
  /** The context window's percent at each measurement, oldest first. */
  contextLog: number[]
}

/** A branch the session started (or began on), and the checkout it lives in. */
export type Tracked = { branch: string; path: string; at: number }

/** One tracked branch's state against the repo's default branch, and its PR. */
export type BranchView = {
  branch: string
  /** The checkout (main or a worktree) the branch was started in. */
  path: string
  /** That checkout's folder name, and whether it's a linked worktree. */
  place: string
  worktree: boolean
  /** The branch still exists locally. */
  exists: boolean
  /** It's what that checkout has checked out now, so the uncommitted counts are its. */
  checkedOut: boolean
  /** Commits ahead of and behind the default branch. */
  ahead: number
  behind: number
  /** Lines added and removed against the default branch, committed and not. */
  insertions: number
  deletions: number
  staged: number
  modified: number
  untracked: number
  conflicted: number
  /** Pushed: the remote has the branch. */
  pushed: boolean
  /** Its most recent PR, if any. */
  pr: GitPr | null
}

/** This session's process tree against the whole machine, from the last sample. */
export type Resources = {
  /** Processes in the session's tree. */
  procs: number
  /** CPU: the tree's and the system's busy share of all cores, 0 to 100. */
  cpu: number
  cpuAll: number
  /** Memory: the tree's resident bytes, and the machine's RAM. */
  mem: number
  memAll: number
  /** Disk: the system's bytes per second, read plus written (macOS has no cheap per-process figure). */
  diskAll: number
  /** Network: bytes per second in plus out; the tree's is null until nettop's first sample. */
  net: number | null
  netAll: number
}

// ---- end session types ----

// ---- issues types (the Issues tab, hooks/issues/) ----

/** A label as GitHub colours it. */
export type Label = { name: string; color: string }

/** A pull request linked to close an issue ("Closes #n"), with its state. */
export type LinkedPr = {
  number: number
  title: string
  url: string
  /** `OPEN`, `MERGED` or `CLOSED`; empty when it lives in another repository and wasn't read. */
  state: string
  isDraft: boolean
  /** GitHub can't merge it for conflicts with its base. */
  conflicting: boolean
  /** Checks failing, and still running. */
  failing: number
  pending: number
}

/** One open issue, slimmed to what the tab draws. */
export type Issue = {
  number: number
  title: string
  url: string
  author: string
  labels: Label[]
  assignees: string[]
  comments: number
  /** When it last changed (ms since epoch). */
  updatedAt: number
  /** The pull requests linked to close it. */
  prs: LinkedPr[]
}

/** The last `gh issue list`: the repository's open issues, newest change first. */
export type IssueList = {
  /** `owner/name`; empty when gh couldn't tell. */
  repo: string
  issues: Issue[]
  /** Whether there are more open issues than were read. */
  more: boolean
  /** When it was last read well (ms since epoch). */
  at: number
  /** Why there's nothing to show, when gh failed on the first read. */
  note?: string
  /** Why the last refresh failed, when these are the last-good issues kept through it. */
  failed?: string
}

// ---- end issues types ----

// ---- tasks types (the Tasks tab, hooks/tasks/) ----

/**
 * A task's state: running (its plan's in-progress step, in a session active in
 * the last day), waiting (the session's last wrap-up asked you something),
 * idle (a pending step, or an in-progress one in a session quiet for a day),
 * done (a completed step).
 */
export type TaskState = 'running' | 'waiting' | 'idle' | 'done'

/** One item of one session's task list. */
export type TaskRow = {
  /** `<sessionId>-<index>`. */
  key: string
  /** The item's content. */
  text: string
  state: TaskState
  /** The first sentence of the session's last wrap-up recap; on the session's current row only, empty elsewhere. */
  recap: string
  /** Completed items of its plan, and all of them: the gauge. */
  done: number
  total: number
  /** The transcript's id (its file name; the app record's `cliSessionId`). */
  session: string
  /** The app's link to the session (`claude://claude.ai/epitaxy/<sessionId>`); empty when the app has no record of it. */
  link: string
  /** The session's title: the app record's title, else its first prompt, cut. */
  title: string
  /** The type of a subagent running in the session now; empty when none. */
  agent: string
  /** The session's last activity (its transcript's mtime, ms since epoch). */
  at: number
  /** Which agent ran the session: a Claude transcript, or a Codex rollout (`~/.codex/sessions/…`, one row per session). */
  harness: 'claude' | 'codex'
}

/** One repo's tasks, running first, then waiting, idle and done. */
export type TaskRepo = {
  /** `owner/name` under ~/Code, else the cwd's last two segments. */
  repo: string
  /** Its most recent session's last activity. */
  at: number
  rows: TaskRow[]
  running: number
  waiting: number
  idle: number
  done: number
}

/** Every session active in the last week, as the Tasks tab draws it. */
export type TaskView = {
  /** When it was read (ms since epoch). */
  at: number
  /** Most recently active first. */
  repos: TaskRepo[]
  /** The waiting rows across repos, most recent first. */
  needs: TaskRow[]
  /** Sessions with a row. */
  sessions: number
  /** Why the transcripts couldn't be read. */
  note?: string
}

// ---- end tasks types ----

// ---- analysis types (the Analysis tab, hooks/analysis/) ----

/** A term's closest neighbour: the stem, its surface form, and their npmi. */
export type AnalysisNeighbour = { term: string; surface: string; npmi: number }

/** One of the run's top terms by count, with its closest neighbours by npmi. */
export type AnalysisTerm = { term: string; surface: string; count: number; neighbours: AnalysisNeighbour[] }

/** One day or week of the run, with its top terms by TF-IDF. */
export type AnalysisBucket = {
  /** The bucket's first day, `YYYY-MM-DD`. */
  start: string
  prompts: number
  sessions: number
  terms: { term: string; surface: string; count: number; tfidf: number }[]
}

/** One topic: its total across the buckets, that as a share of all topics', and its lifespan (`YYYY-MM-DD`). */
export type AnalysisTopic = { id: string; name: string; total: number; share: number; first: string; last: string }

/** focus.json as the Analysis tab draws it; a missing field reads as empty. */
export type AnalysisView = {
  /** focus.json's mtime when read (ms since epoch); 0 when it wasn't there. */
  mtime: number
  generatedAt: string
  since: string
  /** `day` or `week`, as the file says. */
  bucket: string
  /** Prompts across the buckets. */
  prompts: number
  /** Terms the run kept (0 before the run wrote `terms`). */
  termCount: number
  topicCount: number
  /** The top terms; null when the file has no `terms`. */
  terms: AnalysisTerm[] | null
  /** Newest first. */
  buckets: AnalysisBucket[]
  topics: AnalysisTopic[]
  /** Why there's nothing to draw (no file yet, not JSON). */
  note?: string
}

/** The Run action's state: running since `startedAt`, or how the last run ended. */
export type AnalysisRun = { running: boolean; startedAt: number; error: string }

// ---- end analysis types ----

// ---- launcher types (the Launcher tab, hooks/launcher/) ----

/** One entry of `.claude/launch.json`'s `configurations`, as the desktop app reads it. */
export type LaunchConfig = {
  name: string
  runtimeExecutable: string
  runtimeArgs: string[]
  port: number
  /** Relative to the project root (the folder holding `.claude/`); absent, the root. */
  cwd?: string
  env?: Record<string, string>
  /** When the port is taken, run on the next free one instead. */
  autoPort?: boolean
}

/** The project's `.claude/launch.json`, as last read. */
export type LaunchFile = {
  /** The folder holding `.claude/launch.json`; empty when none was found. */
  root: string
  configs: LaunchConfig[]
  /** Why there's nothing to show (no file, unreadable JSON). */
  note?: string
  /** When it was read (ms since epoch). */
  at: number
}

/**
 * - `stopped`: nothing answers on its port;
 * - `starting`: started from this session, its port not answering yet;
 * - `running`: started from this session (or taken over) and answering;
 * - `elsewhere`: something this session didn't start answers on its port, and
 *   it is this configuration's server (its command line or working directory
 *   match), or there's no telling whose it is;
 * - `taken`: the process on its port is another one's (another configuration's
 *   on the same port, or another program);
 * - `failed`: started from this session and exited on its own with an error.
 */
export type Status = 'stopped' | 'starting' | 'running' | 'elsewhere' | 'taken' | 'failed'

/** A server this session didn't start but took over: Stop signals its process. */
export type Adopted = {
  pid: number
  port: number
  /** When it started and its command line, as ps said when it was taken over: Stop signals the pid only while ps still says both (not a later process given the same pid). */
  start: string
  command: string
  /** When it was taken over (ms since epoch). */
  at: number
}

/** A Kill pressed once, waiting for the second press that confirms it. */
export type KillConfirm = {
  name: string
  /** The process the first press found on `port`, and who it was (as in Adopted): the second press signals it only if it's still that. */
  pid: number
  port: number
  start: string
  command: string
  /** When the confirm lapses (ms since epoch, the engine's clock). */
  until: number
}

/** One configuration's server as the tab draws it. */
export type Server = {
  status: Status
  /** The port it runs on: the configuration's, or the free one `autoPort` picked. */
  port: number
  /** The last lines it wrote, oldest first (at most 200). */
  log: string[]
  /** How it last ended: its exit code, null for a signal or while it runs. */
  code: number | null
  /** When this session started it (ms since epoch); 0 when it didn't. */
  startedAt: number
  /** While it answers: the CPU (percent of one core) of the process listening on its port, one sample a tick while the tab is shown, oldest first (at most 60). Absent when it can't be measured (no lsof or ps). */
  cpu?: number[]
  /** While it answers: that process's resident memory, in bytes, at the last sample. */
  rss?: number
  /** The process listening on its port when this session didn't start it (lsof), and its command line (ps). */
  pid?: number
  command?: string
  /** Running because it was taken over: its output isn't the launcher's to show. */
  adopted?: boolean
}

// ---- end launcher types ----

/** Whether a wide app pane flows a view's items into columns (its footer's switch); on until flipped. Lab's and blast-radius's. */
export type ColumnsView = boolean

declare module 'claude-code' {
  interface PluginState {
    'syns-dashboard': {
      brain: BrainView | null
      prs: PrRow[]
      /** Every `~/.syns/epics/<id>/epic.json`, review first; null before the first read. */
      epics: EpicRow[] | null
      agents: AgentRow[]
      /** Each running agent's latest tool call, in words, by agent id. */
      doing: Record<string, string>
      /** Folded sections, by id. */
      collapsed: string[]
      /** Whether a wide app pane flows the sections into columns; on until flipped. */
      columns: boolean
      /** Whether Pull requests lists its ignored repos and PRs (the header's "N ignored" pressed). */
      ignoredOpen: boolean
      /** List items unfolded (`pod-<id>` to what it's about, `decided-<id>` to its note, question and reason); folded by default. */
      unfolded: string[]
      /** The PR (`owner/repo#n`) whose ⋮ menu is unfolded in Pull requests, if any. */
      prMenu: string | null
      /** The PR (`owner/repo#n`) whose Merge was pressed once and now asks to confirm; cleared after 5 s or when its menu closes. */
      mergeConfirm: string | null
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

      // The Session tab (hooks/session/): the overview mod's state, each key prefixed `session`.
      /** The account's rate-limit windows from the last usage read; null until the first. */
      sessionLimits: Limit[] | null
      /** The session cwd's git state; null until the first read. */
      sessionGit: GitInfo | GitNote | null
      /** The last `gh` read for that repo; null until the first. */
      sessionGh: GhInfo | null
      sessionSnapshot: Snapshot | null
      /** The clock elapsed times are drawn against (ms since epoch). */
      sessionNow: number
      /** Cost, time, turns, tool calls and files: the session's activity. */
      sessionActivity: SessionActivity
      /** The app mode's section ids the person folded. */
      sessionCollapsed: string[]
      /** Whether a wide app pane flows its sections into columns (the footer's switch); on until flipped. */
      sessionColumns: boolean
      /** The session's share of the machine; null until two samples give rates. */
      sessionResources: Resources | null
      /** Branches the session started or began on, oldest first. */
      sessionTracked: Tracked[]
      /** Branches the person closed with ✕. */
      sessionHidden: string[]
      /** Each shown tracked branch's state, newest first. */
      sessionBranches: BranchView[]
      /** The last `gh pr list` for the workspaces; null until the first. Their PRs are kept through a failed one. */
      sessionWorkspacesGh: WorkspacesGh | null
      /** A branch a PR is being created for, while gh runs. */
      sessionCreating: string | null

      // The Issues tab (hooks/issues/), each key prefixed `issues`.
      issuesList: IssueList | null
      /** Issues selected for a sprint, by number. */
      issuesSelected: number[]
      /** The title of the issue being added, while gh runs. */
      issuesAdding: string | null
      /** Whether gh is being read right now. */
      issuesReading: boolean
      /** The issue the terminal's cursor is on (the one whose row holds the focus), by number. */
      issuesCursor: number | null
      /** Whether a wide app pane flows the tiles into columns (the footer's switch); on until flipped. */
      issuesColumns: boolean

      // The Tasks tab (hooks/tasks/), each key prefixed `tasks`.
      /** Every recent session's task list, by repo; null before the first read. */
      tasksView: TaskView | null
      /** Sections the person folded: `needs`, or `repo-<owner/name>`. */
      tasksCollapsed: string[]

      // The Analysis tab (hooks/analysis/), each key prefixed `analysis`.
      /** focus.json's last run; null before the first read. */
      analysisView: AnalysisView | null
      /** The Run action: running, or the last run's error. */
      analysisRun: AnalysisRun
      /** Sections folded (`terms`, `weeks`, `topics`, `bucket-<start>`) or terms unfolded (`term-<stem>`), by id. */
      analysisFolds: string[]
      /** The next run's `--since` (`YYYY-MM-DD`); null takes the file's. */
      analysisSince: string | null
      /** The next run's `--bucket`; null takes the file's. */
      analysisBucket: 'day' | 'week' | null

      // The Launcher tab (hooks/launcher/), each key prefixed `launcher`.
      launcherFile: LaunchFile | null
      /** By configuration name. */
      launcherServers: Record<string, Server>
      /** Configurations whose details and output are unfolded, by name. */
      launcherOpen: string[]
      /** Servers taken over from elsewhere, by configuration name. */
      launcherAdopted: Record<string, Adopted>
      /** The row whose Kill waits for its confirming press, if any. */
      launcherConfirm: KillConfirm | null
      /** Whether a wide app pane flows its rows into columns (the footer's switch); on until flipped. */
      launcherColumns: boolean

      /** The Lab tab (hooks/lab/): whether a wide app pane flows the index's groups and the gallery into columns. */
      labColumns: ColumnsView
      /** blast-radius (hooks/blast-radius/): whether a wide app pane flows the held report's lines into columns. */
      blastColumns: ColumnsView
    }
  }
}
