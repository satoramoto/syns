> [!IMPORTANT]
> **This is a fork.** filetree is by Kurt Buhler ([@data-goblin](https://github.com/data-goblin)):
> the original is [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree),
> MIT licensed ([LICENSE](LICENSE), kept as it came). This copy was taken at upstream
> [`bf8de32`](https://github.com/data-goblin/claude-code-filetree/tree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5)
> (0.2.24) and was changed to fit the other mods in
> [awesome-claude](https://github.com/satoramoto/awesome-claude), where it lived as
> `mods/filetree` (to [`0652eb5`](https://github.com/satoramoto/awesome-claude/tree/0652eb5/mods/filetree)).
> It is now syns' **Files tab**, a tab of the syn dashboard's pane, and is edited here
> (`syns-dashboard/hooks/filetree/`). Changes since upstream are listed under "Changes
> in this fork" at the end. For the original, report issues and send PRs upstream.

<h1 align="center">Claude Code Filetree</h1>

<p align="center">
  An IDE-style file tree for Claude Code that shows what Claude is doing and where in files
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-%E2%89%A5_2.1.287-D97757?logo=claude&logoColor=fff" alt="Claude Code 2.1.287 or newer">
  <img src="https://img.shields.io/badge/version-0.3.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/type-mod-6f42c1" alt="Claude Code mod">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-shimmer.gif" alt="filetree shimmering the file Claude is editing" width="900">
</p>

> [!NOTE]
> Here filetree is the **Files tab** of the syn dashboard (the `syns-dashboard` mod), not a mod of its own. `/syn-filetree` opens the dashboard's pane on Files (`/syn-filetree <path>` pins a folder); the tab row switches to it too. It reads and watches nothing while another tab is shown. Tested on Linux, macOS and Windows; mods don't load in WSL sessions of the Desktop app.

---

## Installation

It comes with the syn dashboard: install `syns-dashboard` (see syns' `AGENTS.md`, "Stable or dev"). Don't install the original (`filetree@claude-code-filetree`) or awesome-claude's `filetree` beside it, or two trees load. For the original, follow [its README](https://github.com/data-goblin/claude-code-filetree#installation).

## Features

- Interactive file tree for the working directory where you're using Claude Code; it follows the cwd, or `/syn-filetree <path>` pins another folder
- Search the file tree, including folders you have not opened yet
- Git status per file and folder in color, with exact lines changed (`+N` `-N`) on modified files and `?:N M:N D:N` file counts on folders
- Branch, upstream and ahead/behind in the header
- Visual indicator of Claude reads and searches (purple), writes (orange) and commits (green); collapsed folders open to show the file

  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-read.gif" alt="Files shimmer purple while Claude reads and searches them" width="800">

- Git and GitHub operations via `git` and `gh` (commit, push, pull, checkout, merge, PR and more) shown as a status at the bottom of the pane

  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-git.gif" alt="A committed file shimmers green and the footer shows the commit" width="800">

- Selection-aware: the selected file is passed to Claude as context through a `prompt.submit` hook, and `@path` mentions in a prompt reveal that file in the tree

  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-ask.gif" alt="Selecting config.yaml in the tree and asking Claude what it changed there" width="800">

- File and folder sizes: the `Σ` header button swaps the date column for sizes; folders show their disk usage (`du`, or a summed listing on Windows), worked out in the background for the rows on screen and refreshed after Claude writes
- Double-click a file to open it in its default app
- Click to select, arrow keys to move through the tree
- Light on large repos: outside a repo it only checks once whether one exists, and every git call is scoped to the cwd
- Nerd Font icons with a plain Unicode fallback
- Follows the terminal's theme: it draws on the terminal's own background in Claude Code's theme colours, so it reads on light, dark and ANSI-only themes alike (this fork leaves out upstream's Omarchy background and selection colours, fixed colours that don't read on all of them)
- The cursor row is marked `▌` in the gutter, bold while the pane has the keyboard; key hints show at the foot then

### Resizing the pane

You can resize the pane with the mouse, or by setting custom `pane:grow` or `pane:shrink` keybindings in `keybindings.json`

<p align="center">
  <img src="https://raw.githubusercontent.com/data-goblin/claude-code-filetree/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5/media/filetree-resize.gif" alt="Dragging the filetree pane edge to resize it" width="900">
</p>

## Settings

The dashboard has no settings (`userConfig`) yet, so the defaults below apply; the
tree still reads them from the options it's given, for when it does.

- **Claude activity:** what shimmers: `reads and writes` (default), `writes`, `reads` or `none`. Git status, line counts and the git status at the bottom always show.
- **Follow Claude:** `on` (default) scrolls the tree to what Claude reads, writes or commits; `off` keeps the view where you put it, and highlights still show.
- **Right column:** `date` (default) or `size`; what the right column shows when a session starts. The `Σ` button in the header toggles it.
- **Open with:** empty (default) opens a double-clicked file in its default app. `preview` shows it in the pane instead: Markdown rendered, code highlighted, arrow keys, Page Up/Down and the wheel to scroll, `←`/`h` or `← files` back to the tree, `↗` the default app. Otherwise a command that double-click and Enter run instead: `{path}` is the file and `{dir}` its folder, and without `{path}` the path goes last. It runs without a shell, so quote a word that holds spaces, and it should start the viewer and return rather than wait for it. Examples: `zed {path}`, `code -g {path}`, or in herdr a tab running [herdr-file-viewer](https://github.com/smarzban/herdr-file-viewer) on the file: `herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement tab --focus --env HERDR_FILE_VIEWER_OPEN={path}`.
- **Glyphs:** `auto` (default) uses Nerd Font icons when a Nerd Font is installed and your terminal started after it was installed, plain Unicode in the desktop app, and Nerd Font over SSH. `nerd` or `plain` forces one.

## herdr

Clicking rows needs herdr 0.9.1 or later. herdr 0.9.0 and older accept pixel mouse reporting but still send cell positions, which would put every click in the session in the wrong place, so on those versions the rows ignore the mouse and the rest of the pane and session keep working. Run `herdr update` to get row clicks.

## Contributing

It is built and checked with the rest of the dashboard: see syns'
[AGENTS.md](../../../AGENTS.md). Its tests are in `tests/`. Upstream's pre-commit hook
and its macOS, Windows and Linux CI weren't brought over.

## License

[MIT](LICENSE), copyright Kurt Buhler. The license is kept unchanged with the code.

*This project is inspired by my Omarchy app [FileBlade](https://github.com/data-goblin/fileblade)*

## Changes in this fork

From upstream [`bf8de32`](https://github.com/data-goblin/claude-code-filetree/commit/bf8de321fcd03a9edb893b9ef3e3cc0e4af5bee5):

- Moved to `mods/filetree/` in awesome-claude.
- A desktop version (0.3.0): in the desktop app the pane is drawn with the shared kit,
  as the other mods are (`hooks/desktop.tsx`). A header with the folder and its actions
  as icons, the branch line with ahead/behind and lines changed, the search field,
  then rows with GitHub's file and folder icons, git status colours, lines changed and
  dates or sizes in greys, the picked row highlighted, and a footer with the selection
  (and an open button) and git's latest step. The rows are drawn by the render hook
  rather than the terminal's `Client`, which can't draw icons; Claude's reads and
  writes light their rows (blue for reads, amber for writes, green for commits, with a
  rail beside them) for as long as the terminal's shimmer runs, and the pane scrolls
  to them. A press on a row selects it and opens a folder, a second press opens a
  file; arrow keys stay the terminal's. The terminal draws exactly as before.
  Changed files say so in their first line.
- Another mod can draw the tree in a tab of its own pane (0.5.6): `attach(on, options,
  pane)` in `hooks/register.tsx` registers the tree's hooks for that pane, the tree
  reading nothing until it first draws there. syns' dashboard copies `hooks/` for its
  Files tab.
- Not brought over: the demo GIFs in `media/` (this README links upstream's), the
  repository's own marketplace, its pre-commit hook and its platforms CI.
- This README: the fork notice, install from awesome-claude, and this section.
- Moved to syns as the dashboard's Files tab (from awesome-claude `0652eb5`), edited
  here in `syns-dashboard/hooks/filetree/`: no pane or plugin of its own. `attach`
  is its only entry; it returns `/filetree [path]` for the dashboard to register,
  which opens the dashboard's pane on Files. Its hooks pass through while another
  tab is shown, and its `ui.message` hook is matched on its rows. Its state is the
  dashboard's (`filesTree`, `filesActivity`). Not brought over: its own plugin
  manifest, `hooks.json` and `scripts/check-open.ts`.
