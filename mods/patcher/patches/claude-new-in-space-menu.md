# claude-new-in-space-menu

The space right-click menu's **New worktree** opens the `claude-new` dialog for the
right-clicked space (not the focused one) instead of the bare worktree dialog. Its New
worktree box is checked by default, so a new worktree starts a Claude session.

Made on top of: `use-patched-copies` (its `choose()` hunk has the base's `my-worktree`
line as context). The patch has one line of context (`diff -U1`).

## What it does

- `my-menu`, `choose()`: an item `["…", "worktree", { space, action: "new" }]` (New worktree)
  opens `claude-new` as a 560px dialog with `{ space, folder }`, `folder` being the space's
  place (its first terminal's live folder), instead of `my-worktree`. Done in `choose()`, not
  on the item, because `open-all-worktrees` changes the item's line.
- Depends on `mods/claude-new` reading `props().space` / `props().folder` as its target.

## What it expects from Herdr's original

- `mods/menu/main.js`:
  - `items(p, git)`, `case "space"`: New worktree's item has command `"worktree"` and args
    `{ space: tg.id, action: "new" }`.
  - `place(s)` (a space's folder) and `spaces` imported from `"herdr"`.
  - `choose(i, cx)`: `closeOverlay(props()?.overlay);` followed by the
    `if (it[1] === "worktree") openOverlay(...)` line (as `use-patched-copies` leaves it).

## How to check it works

1. Right-click a git space that isn't the shown one and choose New worktree: the claude-new
   dialog opens with New worktree checked, its subtitle naming that space's folder.
2. Start: a worktree of that space's repo opens with `claude` running.
3. Open worktree and Remove worktree still open the worktree dialog.
