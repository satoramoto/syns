import type { Elements, RenderElement } from 'claude-code'

import { ago } from '../../kit/format'
import { C, GRAY, MUTED, treePrefix } from '../../kit/tokens'
import { BLANK, EDGE, SPACE, kit } from '../../kit/ui'
import type { FlowSwitch, RightPart } from '../../kit/ui'

import type { Issue, IssueList, LinkedPr } from '../../types'

/** The app surfaces' elements; `Input` only where the surface draws fields (not mobile). */
export type AppElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Link' | 'Button' | 'Svg'> & Partial<Pick<Elements['desktop'], 'Input'>>
export type TermElements = Pick<Elements['terminal'], 'Box' | 'Text'> & Partial<Pick<Elements['terminal'], 'Button'>>

/** Open issues are green, as GitHub draws them. */
const OPEN = C.ok

/** The header's figures: how many are open, and how many of those changed in the last day. */
const counts = (list: IssueList, at: number) => {
  const fresh = list.issues.filter(i => at - i.updatedAt < 86_400_000).length
  return { open: `${list.issues.length}${list.more ? '+' : ''}`, fresh }
}

/** The label an issue gets once refined; Start asks to refine first without it. */
export const REFINED = 'refined'

/** What the pane's controls do; the hooks module runs them with its `$`. */
export type Actions = {
  /** Opens an issue with this title. */
  add: (title: string) => void
  refine: (issue: Issue) => void
  start: (issue: Issue) => void
  /** Adds an issue to the sprint selection, or takes it out. */
  toggle: (issue: Issue) => void
  clear: () => void
  /** Hands every selected issue to the session as one sprint. */
  sprint: () => void
  /** The issues selected for a sprint, by number. */
  selected: number[]
  /** The title being added, while gh runs. */
  adding: string | null
  /** Changes after each add, so the field comes back empty. */
  formKey: number
  /** The column view's switch: on, a wide pane flows the tiles into columns. */
  flow?: FlowSwitch
}

/**
 * The app surfaces: the repository as a plain line, a field to add an issue,
 * then a tile per issue.
 *
 *   [issue icon]  Title of the issue…           (bug) (refined)  #12
 *   [pr icon] #31 Title of a linked PR                    1 failing
 *   by someone                 [💬] 3  2d   Refine  Start  Select
 */
export const renderApp = (els: AppElements, list: IssueList | null, columns: number, at: number, act: Actions): RenderElement => {
  const { Box, Text, Link, Button, Input } = els
  const k = kit(els, 'desktop', columns, { flow: act.flow })
  if (!list) return <Text dimColor>Reading issues…</Text>
  const { open, fresh } = counts(list, at)

  const row = (key: string, l: (RenderElement | null)[], r: (RenderElement | null)[]) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" gap={SPACE.item} width="100%">
      <Box flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={1} minWidth={0} overflow="hidden">
        {l}
      </Box>
      <Box flexDirection="row" alignItems="center" gap={SPACE.item} flexShrink={0}>
        {r}
      </Box>
    </Box>
  )

  // Every line of a tile starts with the same icon column, as a section header's does,
  // so the title and each linked PR start their text at one x.
  const lead = (key: string, icon: RenderElement | null) => (
    <Box key={key} width={2} flexShrink={0} flexDirection="row" alignItems="center">
      {icon}
    </Box>
  )

  /** A link that reads by its blue alone, no underline: its text handed to the Link as a child. */
  const link = (key: string, href: string, text: string) => (
    <Link key={key} href={href} label={text}>
      <Text color={C.blue}>{text}</Text>
    </Link>
  )

  /**
   * A secondary action: dim at rest (`dimColor` on the Button), as the desktop draws
   * a Button's label alone and never a child Text, so a grey child never showed there.
   */
  const quiet = (key: string, label: string, onPress: () => void) => k.action({ key, label, onPress, quiet: true })

  /**
   * An action whose word is coloured: the word as a coloured Text and over it a Button
   * labelled with as many Braille blanks (drawn as nothing), since the desktop draws a
   * Button's label uncoloured and never its children. A press on the word is the Button's.
   */
  const tinted = (key: string, label: string, color: string, onPress: () => void) => (
    <Box key={`${key}-tint`} position="relative" flexShrink={0} flexDirection="row">
      <Text color={color}>{label}</Text>
      <Box position="absolute" top={0} left={0}>
        <Button key={key} plain label={BLANK.repeat([...label].length)} onPress={onPress} />
      </Box>
    </Box>
  )

  const picked = (issue: Issue) => act.selected.includes(issue.number)
  // In columns when the pane is wide: the columns space the tiles, so none keeps a margin of its own.
  const flowing = list.issues.length > 0 && k.flowColumns(list.issues.length).count > 1
  const tile = (issue: Issue, i: number) => {
    const refined = issue.labels.some(l => l.name === REFINED)
    return (
      <Box key={`issue-${issue.number}`} width="100%" marginTop={i === 0 || flowing ? 0 : SPACE.block}>
        {k.tile(`tile-${issue.number}`, [
          // The title line, then a little room before the rest of the tile.
          <Box key="l1" width="100%" marginBottom={SPACE.block / 2}>
            {row(
              'title',
              [
                lead('i', k.icon('issue-opened', OPEN)),
                <Text key="t" wrap="truncate">
                  {issue.title}
                </Text>,
              ],
              // Its labels as GitHub pills, then its number; the title gives way to them.
              [...issue.labels.map(l => k.pill(`label-${l.name}`, l.name, l.color)), link('n', issue.url, `#${issue.number}`)],
            )}
          </Box>,
          // Each PR linked to close it, as the overview's workspaces draw one: its state in the icon's glyph and colour.
          ...issue.prs.map(pr =>
            row(
              `pr-${pr.number}`,
              [
                lead('i', k.icon(prIcon(pr), prColor(pr))),
                link('n', pr.url, `#${pr.number}`),
                pr.title ? (
                  <Text key="t" color={GRAY.light} wrap="truncate">
                    {pr.title}
                  </Text>
                ) : null,
              ],
              [prNote(Text, pr)],
            ),
          ),
          // The footer, with the same room above it as the title has below, when PRs sit between.
          <Box key="l3" width="100%" marginTop={issue.prs.length ? SPACE.block / 2 : 0}>
          {row(
            'footer',
            [
              // The byline sits flush left, under the icons rather than the titles.
              <Text key="by" color={GRAY.mid} wrap="truncate">
                {issue.assignees.length ? `assigned to ${issue.assignees.join(', ')}` : `by ${issue.author}`}
              </Text>,
            ],
            [
              issue.comments ? (
                <Box key="c" flexDirection="row" alignItems="center" gap={SPACE.pair}>
                  {k.icon('comment', GRAY.dark)}
                  <Text color={GRAY.mid}>{String(issue.comments)}</Text>
                </Box>
              ) : null,
              <Text key="age" color={GRAY.dark}>
                {ago(at - issue.updatedAt)}
              </Text>,
              // Refine until it's refined; Start always (it asks to refine first when it isn't).
              refined ? null : quiet(`refine-${issue.number}`, 'Refine', () => act.refine(issue)),
              <Button key={`start-${issue.number}`} plain label="Start" onPress={() => act.start(issue)} />,
              // Picks it for a sprint: the word turns blue and the tile takes the selected fill.
              picked(issue)
                ? tinted(`pick-${issue.number}`, 'Selected', C.blue, () => act.toggle(issue))
                : quiet(`pick-${issue.number}`, 'Select', () => act.toggle(issue)),
            ],
          )}
          </Box>,
        ], { selected: picked(issue) })}
      </Box>
    )
  }

  // Quick add: a title and Enter opens the issue; the field comes back empty.
  const form = Input ? (
    <Box key="add" width="100%" marginBottom={SPACE.block}>
      {act.adding ? (
        <Text dimColor wrap="truncate">{`Adding “${act.adding}”…`}</Text>
      ) : (
        <Input key={`new-issue-${act.formKey}`} placeholder="New issue title" submitLabel="add" onSubmit={(title: string) => act.add(title)} />
      )}
    </Box>
  ) : null

  // Once anything is selected: how many, Clear, and Sprint, which hands them all over at once.
  const chosen = list.issues.filter(picked).length
  const bar =
    chosen ? (
      <Box key="sprint" width="100%" marginBottom={SPACE.block}>
        {row(
          'sprint-row',
          [<Text key="n">{`${chosen} selected`}</Text>],
          [quiet('clear', 'Clear', () => act.clear()), <Button key="go" plain label={`Sprint (${chosen})`} onPress={() => act.sprint()} />],
        )}
      </Box>
    ) : null

  const body: (RenderElement | null)[] = list.note
    ? [<Text key="note" dimColor>{list.note}</Text>]
    : [form, bar, ...(list.issues.length ? k.flow('issues', list.issues.map(tile), { gap: SPACE.block }) : [<Text key="none" dimColor>No open issues.</Text>])]

  // One repository, so no foldable header: its name as a plain line, the counts on the right.
  const head = row('repo', [<Text key="r" color={GRAY.mid} wrap="truncate">{list.repo || 'Issues'}</Text>], [list.note ? null : k.summary([[open, 'open', OPEN], fresh ? [String(fresh), 'today'] : null])])
  // The column view's switch, on a pane wide enough for columns: a footer band across the pane, under the body's edges.
  const footer = k.footer()
  const page = (
    <Box key="page" flexDirection="column" paddingLeft={EDGE.left} paddingRight={EDGE.right} marginTop={SPACE.block}>
      <Box key="head" width="100%" marginBottom={SPACE.block}>
        {head}
      </Box>
      {body}
    </Box>
  )
  return footer ? (
    <Box flexDirection="column">
      {page}
      {footer}
    </Box>
  ) : (
    page
  )
}

/** A linked PR's icon: GitHub's for its state; unread (another repository), the open one. */
const prIcon = (pr: LinkedPr) => (pr.state === 'MERGED' ? 'pr-merged' : pr.state === 'CLOSED' ? 'pr-closed' : pr.isDraft ? 'pr-draft' : 'pr-open')

/** A linked PR's colour, as the overview's workspaces colour one: merged purple, closed or draft grey; open green, red on conflicts, amber while CI fails. */
const prColor = (pr: LinkedPr) =>
  pr.state === 'MERGED' ? C.purple : pr.state === 'CLOSED' || pr.isDraft || !pr.state ? MUTED : pr.conflicting ? C.bad : pr.failing ? C.warn : C.ok

/** What an open PR's checks say, on the right of its line, in the surface's ink for the colour. */
const prNote = (Text: AppElements['Text'], pr: LinkedPr, ink: (color: string) => object = color => ({ color })): RenderElement | null => {
  if (pr.state !== 'OPEN') return null
  if (pr.conflicting) return <Text key="ci" {...ink(C.bad)}>conflicts</Text>
  if (pr.failing) return <Text key="ci" {...ink(C.warn)}>{`${pr.failing} failing`}</Text>
  if (pr.pending) return <Text key="ci" {...ink(C.blue)}>{`${pr.pending} pending`}</Text>
  return null
}

/** Cells an issue's title keeps before its labels give way, on the terminal (half the body when that's more). */
const TITLE_MIN = 16

/** How the terminal pane stands and what its rows do; the hooks module fills it. */
export type TermState = {
  /** Whether the pane has the keyboard (`e.props.isFocused`): key hints show, the cursor is drawn at full strength. */
  focused?: boolean
  /** Whether gh is being read right now. */
  reading?: boolean
  /** The issue the cursor is on, by number. */
  cursor?: number | null
  /**
   * Enter on a row's mark: hands the issue to the session to start. Given, each
   * row leads with a focusable mark the arrows walk, and the list draws a cursor.
   */
  start?: (issue: Issue) => void
}

/** The key of the focusable mark that leads an issue's row on the terminal. */
const markKey = (n: number) => `mark-${n}`

/** The issue a focused element's key names (a row's mark), or null. */
export const cursorOf = (key: string | undefined): number | null => {
  const m = /^mark-(\d+)$/.exec(key ?? '')
  return m ? Number(m[1]) : null
}

/** What the terminal's keys do while the pane has them: the most used first. */
const HINTS = [
  { key: '↑↓', label: 'move' },
  { key: 'enter', label: 'start' },
]

/**
 * The terminal: one section, the repository's name as its title and the open
 * count after it; an item per issue, its first label as a pill where it fits
 * (`+1` for the rest), its number and age on the right; each linked PR on a dim
 * tree row under it, its checks in their status colour. An issue with PRs is a
 * block: a blank row parts it from its neighbours. With `start`, each row leads
 * with a focusable mark: the row under the focus is the cursor's (`▌` in the
 * gutter), Enter starts it, and the keys show under the list, lined up with
 * the rows' marks.
 *
 *   awesome-claude  5 open ─────────────────────── ▾
 *     ◉ Workspaces: show which checks…  ■ overview  #21  3d
 *
 *    ▌◉ Snapshot tests of what…            ■ tests  #24  2h
 *     └─⇡ #31  Snapshot tests for…           1 failing
 *
 *     ↑↓ move · enter start
 *
 * Each fact once: the ages are on the rows, so the header doesn't count the
 * day's changes; every issue here is open, so its mark is dim rather than green.
 * A read under way shows the figures' age (`↻ 2m`); a failed one an amber `▲`
 * and the age, the last-good issues kept. Only a first read that fails, with
 * nothing to keep, is an error note.
 */
export const renderTerminal = (els: TermElements, list: IssueList | null, columns: number, at: number, st: TermState = {}): RenderElement => {
  const { Box, Text, Button } = els
  const k = kit(els, 'terminal', columns, { focused: st.focused })
  const pane = (title: string, right: RenderElement | null, body: (RenderElement | null)[], loading = false) =>
    k.section({ id: 'issues', title, right: right ?? undefined, loading, children: body })

  // The repository's name without its owner: the owner rarely tells, and the full
  // `owner/name` ran into the figures in a 40-column pane.
  const title = list?.repo ? list.repo.split('/').pop() || list.repo : 'Issues'
  if (!list) return pane('Issues', null, [k.note('loading', 'Reading issues…', 'loading')], true)
  if (list.note) return pane(title, null, [k.note('error', list.note, 'error')], Boolean(st.reading))

  const { open } = counts(list, at)
  // Rows take the keyboard when Enter has something to do: every row then says whether it's the cursor's.
  const keys = Boolean(st.start && Button)
  const chosen = (n: number) => (keys ? st.cursor === n : undefined)
  const gutter = keys ? 1 : 0
  const ages = list.issues.map(i => ago(at - i.updatedAt))
  // Numbers and ages right-aligned in columns of their own, so they line up row to row.
  const ageWidth = Math.max(0, ...ages.map(a => a.length))
  const numberWidth = Math.max(0, ...list.issues.map(i => `#${i.number}`.length))
  const figure = (key: string, text: string, width: number) => (
    <Box key={key} width={width} flexShrink={0} flexDirection="row" justifyContent="flex-end">
      <Text dimColor>{text}</Text>
    </Box>
  )

  // The number's column has a cell more on its left, so a label's name and the number sit two apart.
  const numberCells = numberWidth + 1

  const issueRow = (issue: Issue, age: string, i: number) => {
    // The lead's two cells, the gap before the right cluster, the number and the age.
    const keep = Math.max(TITLE_MIN, Math.floor(k.width / 2))
    const used = gutter + 2 + k.space.item + numberCells + k.space.item + ageWidth + Math.min([...issue.title].length, keep)
    // One label, GitHub's first, while it fits beside the title's minimum (its swatch, a space, its
    // name, the gap before it); the rest say only how many they are. Should the row still run short,
    // the count goes first, then the label, then the age, then the number.
    const labels: RightPart[] = []
    const first = issue.labels[0]
    if (first) {
      const cells = 2 + [...first.name].length
      if (used + cells + k.space.item <= k.width) {
        labels.push({ part: k.pill(`label-${first.name}`, first.name, first.color), drop: 3, cells })
        const rest = issue.labels.length - 1
        const more = `+${rest}`
        if (rest > 0 && used + cells + 2 * k.space.item + more.length <= k.width) labels.push({ part: more, drop: 4 })
      }
    }
    // Each linked PR on a dim row: what it is reads from its icon and its checks' status colour.
    const prs = issue.prs.map((pr, j) =>
      k.item(`pr-${issue.number}-${pr.number}`, {
        tree: treePrefix([], j === issue.prs.length - 1),
        lead: prIcon(pr),
        leadColor: prColor(pr),
        text: `#${pr.number}`,
        dim: true,
        note: pr.title || undefined,
        right: [prNote(Text, pr, k.ink)],
        // In the gutter's column too, so the tree lines up under its issue.
        selected: keys ? false : undefined,
      }),
    )
    // The open-issue mark, dim: every issue here is open. With keys, a Button the focus ring lands on,
    // Enter on it starting the issue.
    const lead =
      keys && Button ? (
        <Button key={markKey(issue.number)} plain label={`#${issue.number}`} onPress={() => st.start!(issue)}>
          {k.icon('issue-opened', MUTED)}
        </Button>
      ) : (
        'issue-opened'
      )
    // An issue with PRs under it is a block: one blank row parts it from the issue before.
    const prev = list.issues[i - 1]
    const apart = prev && (prev.prs.length > 0 || issue.prs.length > 0)
    return (
      <Box key={`issue-${issue.number}`} flexDirection="column" marginTop={apart ? k.space.block : 0}>
        {k.item(`row-${issue.number}`, {
          lead,
          leadColor: MUTED,
          text: issue.title,
          right: [
            ...labels,
            { part: figure('n', `#${issue.number}`, numberCells), drop: 1, cells: numberCells },
            { part: figure('age', age, ageWidth), drop: 2, cells: ageWidth },
          ],
          selected: chosen(issue.number),
        })}
        {prs}
      </Box>
    )
  }

  // Last-good figures say how old they are while a read is under way, or once one failed.
  const age = st.reading || list.failed ? ago(Math.max(0, at - list.at)) : undefined
  // The key hints, a block of their own under the list, starting in the rows' mark column (past the
  // cursor's gutter) rather than a cell left of them.
  const hints = keys ? k.hints('hints', HINTS, { width: k.width - gutter }) : null
  return pane(
    title,
    // The open count, bold as the figure that matters, in the default foreground: an issue being
    // open is no status here. The ages on the rows say what changed today, so the header doesn't.
    k.summary([[open, 'open']], { loading: st.reading, age, failed: Boolean(list.failed) }),
    list.issues.length
      ? [
          ...list.issues.map((issue, i) => issueRow(issue, ages[i]!, i)),
          hints ? (
            <Box key="keys" marginTop={k.space.block} paddingLeft={gutter}>
              {hints}
            </Box>
          ) : null,
        ]
      : [k.note('empty', 'No open issues.')],
  )
}
