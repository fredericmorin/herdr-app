# sync-new-worktrees

Runs `mods/worktree-sync` (a personal mod, not a copy), which opens a space for each new
worktree made outside the dialog, and makes the dialog claim its own new worktrees so
they don't get a second space.

Made on top of: `use-patched-copies` (it extends its floating list in the layout).

## What it does

- `my-main.json`: a second floating block on the root, `worktree-sync`. It draws nothing;
  it's there so the mod runs.
- `my-worktree`: before New worktree runs `git worktree add`, it records the branch in the
  shared value `worktree-sync.claims` (`{ branch: ms }`, entries older than 10 minutes
  dropped). worktree-sync skips claimed branches, because the dialog opens their space
  itself.

worktree-sync itself (in `mods/worktree-sync/main.js`): for each repo with a space open, it
opens a background space for any checkout that appears after it first saw the repo, unless
claimed or already shown. A checkout `git worktree add` is still making (`locked initializing`,
at first without its branch) waits until git is done. It remembers the checkouts it has seen,
so a space you close stays closed. Local repos are watched; every repo is looked at once a minute.

## What it expects from Herdr's original

- `layouts/main.json`: nothing beyond `use-patched-copies`; the patch turns its single
  floating entry (`{ "id": "patcher", … }`) into a list of two.
- `mods/worktree/main.js`:
  - The line `export default class Worktree extends View {`, preceded by a blank line: the
    `claim()` helper and its own `import { shared, setShared } from "herdr";` go right
    before it (a separate import, so this patch doesn't share the import line with others).
  - `work(cx)`: it starts with `const remove = props()?.action === "remove";`, and after
    `cx.notify();` comes
    `try { this.error = remove ? await this.remove() : await this.create(); }`;
    the claim runs just before that `try`, unless `remove`. It sits in `work()` rather
    than `create()` so it shares no lines with `project-worktree-settings`.
  - `create()` reads the branch from `this.text.trim()` and runs `git worktree add` with it.

## How to check it works

- `herdr-app status` shows a float `worktree-sync` with 0×0 bounds.
- In a repo with a space open, `git worktree add -b x ../x` in a terminal: a space for it
  appears, nested under the repo, within a second.
- New worktree from the dialog: exactly one space for it (no second one from worktree-sync).
- Close a worktree's space: it stays closed.
