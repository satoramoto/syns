/**
 * A skin: the colours the kit draws with on the app surfaces (desktop, VS Code, mobile), one per
 * meaning (see kit/tokens.ts). Each zen theme pack gives one (kit/skins.ts, made from the pack's
 * palette by zen's `src/harness/claude-code/skins.ts`); a mod wears one with `wear()`.
 *
 * The terminal never draws these values: it draws each meaning in the terminal theme key that
 * means the same thing (THEME_KEY, TERM_TINT in kit/tokens.ts), whatever the skin, so a mod
 * follows the person's terminal theme.
 *
 * Every value is #rrggbb, and every value is its meaning's own: no two meanings share a value,
 * as the terminal finds a meaning by its value. Greys may share one another's.
 */
export type Skin = {
  /** The pack's name, as zen's toolbar shows it. */
  readonly label: string
  /** Finished well: checks passed, an agent done. */
  readonly ok: string
  /** Getting close to a limit: 75% and up, the compaction mark. */
  readonly warn: string
  /** Failed, conflicted, 90% and up. */
  readonly bad: string
  /** Live or in progress: running, pending, the activity series. */
  readonly blue: string
  /** Merged. */
  readonly purple: string
  /** A tint for parts within one chart, never a status. */
  readonly cyan: string
  /** Quantity ink: what a bar or gauge is drawn in when it only says how much. */
  readonly slate: string
  /** A tint for parts within one chart, never a status. */
  readonly orchid: string
  /** Shades within one chart: the live colour and the quantity ink, each base first, then darker, lighter, darkest. */
  readonly ramp: { readonly blue: readonly [string, string, string, string]; readonly slate: readonly [string, string, string, string] }
  /** Text, icons and marks that should recede. */
  readonly muted: string
  /** Text below the main text, each a step quieter. */
  readonly gray: { readonly light: string; readonly mid: string; readonly dark: string }
}
