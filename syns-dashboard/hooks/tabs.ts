// The dashboard's pane and which of its tabs is on screen, shared with the mods
// that draw in it (`hooks/<mod>/`). Nothing here takes `$`: the engine follows `$`
// within one file only, so each mod's hooks do their own reads and writes and ask
// this module only what is shown.
import type { DashTab } from '../types'

/** The dashboard's pane, which every tab draws in. */
export const PANE = 'syns-dashboard'
/** The pane's title. */
export const TITLE = 'syn'
// A mod's slash command opens the pane on its tab by writing the dashboard's `tab`
// state; each declares that atom itself (`{ plugin: 'syns-dashboard', key: 'tab' }`),
// since the engine reads an atom's plugin and key as literals in the file using it.

/** A slash command a mod adds; the dashboard registers it as the session starts (one `session.start` per plugin). */
export type Command = { name: string; description: string; argumentHint?: string; immediate?: true }

let current: DashTab | null = null

/** The tab on screen now, or null while the pane is off screen. A mod's hooks pass through, and its reads wait, unless it's theirs. */
export const shownTab = (): DashTab | null => current

/** The dashboard's render sets the tab it draws; its tick sets null when the pane goes off screen. */
export const showTab = (tab: DashTab | null): void => {
  current = tab
}
