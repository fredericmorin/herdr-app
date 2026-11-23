# open-all-worktrees

An **Open all worktrees** item in the space right-click menu and the tab bar's + menu:
it opens a space for every checkout of the repo that doesn't have one yet.

Made on top of: `use-patched-copies` (it shares lines with it in `new-menu` and `tabs`).

## What it does

- `my-worktree`: a new dialog action, props `{ space, action: "open-all" }`. It reads the
  repo's checkouts like Open worktree, opens a background space (`focus: false`) for each
  one without a space, the main checkout first so the others nest under it, and closes. If
  every checkout is already open, it posts the toast "All worktrees of <repo> are already open".
- `my-menu`: the space menu gets Open all worktrees after Open worktree (only in git repos,
  like the other worktree items); it opens the 440×260 dialog.
- `my-new-menu`: an Open all worktrees row after Open worktree… (disabled with no space
  shown), and the menu grows by one 31px row.
- `my-tabs`: the + menu's popup grows from 512 to 543px to fit that row.

## What it expects from Herdr's original

- `mods/worktree/main.js`:
  - The `import { … } from "herdr"` line, ending `readTextFile, window } from "herdr";`: the
    patch adds `notify` at its end.
  - `init()`: `this.opening = props()?.action === "open";` (open-all counts as opening, so
    it skips `root()` and loads the checkout list), and later
    `if (repo && this.opening) this.list = await checkouts(repo, this.on);` then
    `this.repo = repo; cx.notify();`: `openAll()` runs right after that.
  - `checkouts(repo, on)` lists the main checkout first; `spaceOf(path, all, on, spaces, panes)`
    finds the space showing a checkout; `this.close()` closes the dialog.
  - `open(c)`, ending `else run("space.new", { folder: c.path, machine: this.on ?? "" });`:
    `openAll()` is inserted after it.
- `mods/menu/main.js`: `items()`, `case "space":`, the git-only row
  `...(git ? [["New worktree", "worktree", …], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : [])`;
  items are `[label, command, args]` and `"worktree"` opens the worktree dialog with args as
  props. `choose()` gives every action but `"open"` the 440×260 dialog.
- `mods/new-menu/main.js`:
  - The root's height `h(Math.min(491, 167 + … * 31))`: the patch adds 31 to both numbers.
  - The chain ends with the Open worktree… row (`this.row("worktree-open", …)`, already
    pointing at `my-worktree`) and `));`: the new row goes after it and takes the `));`.
- `mods/tabs/main.js`: the + button's popup `height: 512`. It must stay 21px above
  new-menu's largest height (Herdr 491 → 512, patched 522 → 543); if Herdr changes it, keep
  the patched one 31px above Herdr's.

## How to check it works

- Right-click a space in a repo: Open all worktrees is listed after Open worktree.
- Click + in the tab bar: Open all worktrees is the last row, nothing clipped.
- Close a worktree's space, then Open all worktrees: it comes back nested under the repo.
- Run it again: the "already open" toast.
