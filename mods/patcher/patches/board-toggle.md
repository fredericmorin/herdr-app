# board-toggle

The tab bar gets a **Terminals / Board** toggle at its left, and the work area can show the
issue board (`mods/issue-board`: Vikunja and Linear chips) in place of the shown tab's panes. Going to a space, tab
or agent while the Board is up shows the terminals again.

Made on top of: `use-patched-copies` (it touches no line of the base; it needs the base's
`my-agents` copy).

## What it does

- `my-main` layout: the `main` block (the active tab) is wrapped in a stack
  `{ "id": "center", "type": "stack", "active": "main" }` whose second child is
  `{ "id": "board", "content": { "mod": "issue-board", "props": { "url": "https://todo.endor.one", "project": 15 } } }`.
  Lines are only inserted (no re-indent), so the hunks stay small.
- `my-tabs`, `render()`: before the tab strip, a segmented toggle (Terminals
  `mods/workspace-chrome/terminal.svg`, Board `mods/issue-board/board.svg`) runs
  `layout.select {stack: "center", child: "main" | "board"}`. The highlight follows
  `find(root, "center").active`. Drawn only when the layout has a `center` node, followed by a
  thin divider.
- `my-tabs`, a tab's `on_mouse_up`: selecting a tab while the Board shows switches back to `main`.
- `my-tabs`, `render()`: a watch. While the Board stays up, a change of `focused()` space, tab or
  pane since the last render selects `main`, so keys (ctrl-1…9, cmd-alt-[/], cmd-[/], ctrl-tab),
  the palette and toasts bring the terminals back. A render that shows the Board and moves focus
  at once (tab-history's `ctrl--` back to a Board place) is left alone.
- `my-spaces` and `my-agents`: a `showTerminals()` helper, called by every space and agent click,
  so clicking the space or agent that's already selected (no focus change, so no watch) also
  switches back.
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
  - `find`, `layout`, `run`, `svg`, `div`, `h_flex`, `stop`, `root` (from `layout()`) in scope.
  - `focused` importable from `"herdr"` (the patch adds it to the import on line 3).
- `mods/spaces/main.js`: `find`, `layout`, `run` in scope; the `narrow` const (the helper goes
  after it); the row's `on_mouse_up` `} else if (from === w.id) run("space.select", { id: w.id });`
  and the rail cell's `.on_click(() => run("space.select", { id: w.id }))`.
- `mods/agents/main.js`: the top `find` function (the helper goes after it), `layout`, `run` in
  scope; the sub-agent row's `.on_click(() => (this.listed.has(k.address) ? run("pane.focus", …) : this.peek(k.address)))`
  and the two `.on_click(() => run("pane.focus", { pane: a.pane }))` (rail cell, agent row).
  The fold, pin and sort clicks are left alone.
- The `tab-scroll` line is context for `use-patched-copies` and `open-all-worktrees`: this patch
  only inserts above it, never changes it.

## How to check it works

1. The tab bar shows `Terminals | Board` at its left; Terminals is highlighted.
2. Click Board: the work area shows the issue board; Board is highlighted.
3. Click a tab: the terminals come back.
4. On the Board, ctrl-2 (another space), cmd-] (next agent), ctrl-tab: the terminals come back.
5. On the Board, click the shown space, then the focused agent: the terminals come back.
6. Show the Board, go to a tab, press ctrl--: the Board shows again and stays.
7. `jq '..|objects|select(.id=="center")' ~/.config/herdr-app/layouts/my-main.json` shows the stack.
