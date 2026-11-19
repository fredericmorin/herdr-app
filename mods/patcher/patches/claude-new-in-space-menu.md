# claude-new-in-space-menu

A **New Claude session** item in the space right-click menu, showing its key (cmd-shift-n).
It opens the `claude-new` dialog for the right-clicked space, not the focused one.

Made on top of: `use-patched-copies` (its `choose()` hunk has the base's `my-worktree`
line as context). The patch has one line of context (`diff -U1`) so its item hunk doesn't
take in the worktree items `open-all-worktrees` changes.

## What it does

- `my-menu`, space menu: New Claude session after the worktree items, before Close (in
  every space, git or not). The item is `["New Claude session", "mod.open", { name:
  "claude-new" }, { space, folder }]`: the 4th element is props, `folder` is the space's
  place (its first terminal's live folder). `shortcut()` finds `mod.open:claude-new` in
  keys.json, so the key shows on the right.
- `my-menu`, `choose()`: an item with a 4th element opens `it[2].name` as a 560px dialog
  with those props, instead of `run(it[1], it[2])` (`mod.open` takes no props).
- Depends on `mods/claude-new` reading `props().space` / `props().folder` as its target.

## What it expects from Herdr's original

- `mods/menu/main.js`:
  - `items(p, git)`, `case "space"`: the lines
    `...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),`
    then `["Close", "space.close", { id: tg.id }],`. The item goes between them.
  - `place(s)` (a space's folder) and `spaces` imported from `"herdr"`.
  - `choose(i, cx)`: `closeOverlay(props()?.overlay);` followed by the
    `if (it[1] === "worktree") openOverlay(...)` line (as `use-patched-copies` leaves it).
  - Items are `[label, command, args]` arrays; a 4th element is otherwise unused.

## How to check it works

1. Right-click a space: New Claude session shows before Close, with ⌘⇧N on the right.
2. Right-click a space that isn't the shown one and choose it: the dialog's subtitle names
   that space's folder. Start with New worktree on: a worktree of that space's repo opens.
3. Uncheck New worktree and Start: a new tab with `claude` opens in that space.
