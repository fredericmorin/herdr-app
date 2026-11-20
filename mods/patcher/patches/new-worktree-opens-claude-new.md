# new-worktree-opens-claude-new

Every **New worktree** menu item opens the `claude-new` dialog instead of the bare worktree
dialog: the space right-click menu's (for the right-clicked space, not the focused one) and
the tab bar's + menu's (for the shown space and the focused pane's folder). Its New worktree
box is checked by default, so a new worktree starts a Claude session.

Made on top of: `use-patched-copies` (its `choose()` hunk has the base's `my-worktree`
line as context). The patch has one line of context (`diff -U1`).

## What it does

- `my-menu`, `choose()`: an item `["…", "worktree", { space, action: "new" }]` (New worktree)
  opens `claude-new` as a 560px dialog with `{ space, folder }`, `folder` being the space's
  place (its first terminal's live folder), instead of `my-worktree`. Done in `choose()`, not
  on the item, because `open-all-worktrees` changes the item's line.
- `my-new-menu`, `row()`: the row with id `"worktree"` (New worktree…) gets an action that
  opens `claude-new` as a 560px dialog with `{ space, folder }`: the shown space and the
  focused pane's folder, the same target the original passed to the worktree dialog. Done
  in `row()`, not on the row's line, because `open-all-worktrees` changes the lines around it.
- Depends on `mods/claude-new` reading `props().space` / `props().folder` as its target.

## What it expects from Herdr's original

- `mods/menu/main.js`:
  - `items(p, git)`, `case "space"`: New worktree's item has command `"worktree"` and args
    `{ space: tg.id, action: "new" }`.
  - `place(s)` (a space's folder) and `spaces` imported from `"herdr"`.
  - `choose(i, cx)`: `closeOverlay(props()?.overlay);` followed by the
    `if (it[1] === "worktree") openOverlay(...)` line (as `use-patched-copies` leaves it).
- `mods/new-menu/main.js`:
  - `row(id, icon, name, action, hint = "", enabled = true)` whose first line is
    `const t = theme();` and whose click calls `action()`.
  - New worktree's row has id `"worktree"` (Open worktree's is `"worktree-open"`) and is
    enabled only when a space is shown.
  - `openOverlay`, `spaces` and `panes` imported from `"herdr"`.

## How to check it works

1. Right-click a git space that isn't the shown one and choose New worktree: the claude-new
   dialog opens with New worktree checked, its subtitle naming that space's folder.
2. In the tab bar, click + and choose New worktree…: the claude-new dialog opens with New
   worktree checked, its subtitle naming the focused pane's folder.
3. Start: a worktree of that repo opens with `claude` running.
4. Open worktree, Open all worktrees and Remove worktree still open the worktree dialog.
