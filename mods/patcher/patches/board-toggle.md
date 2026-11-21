# board-toggle

The tab bar gets a **Terminals / Board** toggle at its left, and the work area can show the
Vikunja board (`mods/vikunja-board`) in place of the shown tab's panes.

Made on top of: `use-patched-copies` (it touches no line of the base).

## What it does

- `my-main` layout: the `main` block (the active tab) is wrapped in a stack
  `{ "id": "center", "type": "stack", "active": "main" }` whose second child is
  `{ "id": "board", "content": { "mod": "vikunja-board", "props": { "url": "https://todo.endor.one", "project": 15 } } }`.
  Lines are only inserted (no re-indent), so the hunks stay small.
- `my-tabs`, `render()`: before the tab strip, a segmented toggle (Terminals
  `mods/workspace-chrome/terminal.svg`, Board `mods/vikunja-board/board.svg`) runs
  `layout.select {stack: "center", child: "main" | "board"}`. The highlight follows
  `find(root, "center").active`. Drawn only when the layout has a `center` node, followed by a
  thin divider.
- `my-tabs`, a tab's `on_mouse_up`: selecting a tab while the Board shows switches back to `main`.
- Depends on `mods/vikunja-board` (the board and its icon).

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
- The `tab-scroll` line is context for `use-patched-copies` and `open-all-worktrees`: this patch
  only inserts above it, never changes it.

## How to check it works

1. The tab bar shows `Terminals | Board` at its left; Terminals is highlighted.
2. Click Board: the work area shows the Vikunja board; Board is highlighted.
3. Click a tab: the terminals come back.
4. `jq '..|objects|select(.id=="center")' ~/.config/herdr-app/layouts/my-main.json` shows the stack.
