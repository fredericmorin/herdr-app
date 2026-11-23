# board-toggle

The tab bar gets a **Board / Terminals** toggle at its left, and the work area can show the
issue board (`mods/issue-board`: the focused space's board) in place of the shown tab's panes. Going to
another space while the Board is up keeps it (it then shows that space's board); going to a tab, a pane or
an agent shows the terminals again.

Made on top of: `use-patched-copies` (it touches no line of the base; it needs the base's
`my-agents` copy).

## What it does

- `my-main` layout: the `main` block (the active tab) is wrapped in a stack
  `{ "id": "center", "type": "stack", "active": "main" }` whose second child is
  `{ "id": "board", "content": { "mod": "issue-board", "props": { "url": "https://todo.endor.one" } } }`.
  Lines are only inserted (no re-indent), so the hunks stay small.
- `my-tabs`, `render()`: before the tab strip, a segmented toggle (Board
  `mods/issue-board/board.svg`, Terminals `mods/workspace-chrome/terminal.svg`) runs
  `layout.select {stack: "center", child: "main" | "board"}`. The highlight follows
  `find(root, "center").active`. Drawn only when the layout has a `center` node, followed by a
  thin divider.
- `my-tabs`, a tab's `on_mouse_up`: selecting a tab while the Board shows switches back to `main`.
- `my-tabs`, `render()`: a watch. While the Board stays up, it compares `focused()` with the last
  render's. Another space, opened at its selected tab (`spaces()` tabs' `active`) and that tab's
  focused pane (`panes()` `focused`), keeps the Board: space clicks, ctrl-1…9, cmd-alt-[/] and the
  palette. A tab or pane change within the shown space (ctrl-tab, pane keys), or landing in another
  space at another tab or pane (a toast's jump to an agent), selects `main`. A render that shows the
  Board and moves focus at once (tab-history's `ctrl--` back to a Board place) is left alone.
- `my-tabs`, `render()`: when `center` goes from `board` back to `main`, `pane.focus` on the focused
  pane, so the terminal has the keyboard again. The Board (`mods/issue-board`) takes the keyboard when
  the space changes under it: Herdr hands it to the new space's terminal, hidden behind the Board,
  where keys (cmd-1/2, cmd-[/]) would reach nothing.
- `my-agents`: a `showTerminals()` helper, called by every agent click, so clicking the agent that's
  already focused (no focus change, so no watch) also switches back. cmd-[/] do the same through
  the keybind mod's `agent-prev` / `agent-next` (`mods/keybind/binds.json`).
- Depends on `mods/issue-board` (the board and its icon).

## What it expects from Herdr's original

- `layouts/main.json`: inside the `work-body` row's `"children": [`, the block
  `{ "id": "main", "type": "block", "content": { "tab": "active", ... } }` written as `            {`
  / `"id": "main",` ... closed by `            },`, followed by the `panel` column.
- `mods/tabs/main.js`, `render()`:
  - the tab item's `.on_mouse_up("left", ...)` with `else run("tab.select", { id: c.id });`;
  - the `panelButton` helper ending in `}).child(svg(icon).size(14)).child(label);` / `};`,
    directly followed by `return h_flex().size_full()...`, `.on_mouse_up(...)`,
    `.on_scroll_wheel(e => this.wheel(e))` and the `tab-scroll` child;
  - `find`, `layout`, `run`, `spaces`, `panes`, `svg`, `div`, `h_flex`, `stop`, `root` (from `layout()`) in scope.
  - `focused` importable from `"herdr"` (the patch adds it to the import on line 3).
- `mods/agents/main.js`: the top `find` function (the helper goes after it), `layout`, `run` in
  scope; the sub-agent row's `.on_click(() => (this.listed.has(k.address) ? run("pane.focus", …) : this.peek(k.address)))`
  and the two `.on_click(() => run("pane.focus", { pane: a.pane }))` (rail cell, agent row).
  The fold, pin and sort clicks are left alone.
- The `tab-scroll` line is context for `use-patched-copies` and `open-all-worktrees`: this patch
  only inserts above it, never changes it.

## How to check it works

1. The tab bar shows `Board | Terminals` at its left; Terminals is highlighted.
2. Click Board: the work area shows the issue board; Board is highlighted.
3. Click a tab: the terminals come back.
4. On the Board, click another space, then press ctrl-2: the Board stays and shows each space's board.
5. On the Board, ctrl-tab, cmd-] (next agent), click the focused agent, click an agent toast: the
   terminals come back, on that agent's tab.
6. On the Board, click another space, then press cmd-2: the terminals come back and typing reaches
   the terminal; cmd-1 shows the Board again.
7. Show the Board, go to a tab, press ctrl--: the Board shows again and stays.
8. `jq '..|objects|select(.id=="center")' ~/.config/herdr-app/layouts/my-main.json` shows the stack.
