# remove-locked-worktrees

Remove worktree handles locked worktrees (Supacode locks the ones it makes): the dialog
warns that it's locked, and Enter removes it anyway, overriding the lock.

Made on top of: `use-patched-copies` (the space menu opens `my-worktree`).

## What it does

In `mods/worktree` → `my-worktree` (the Remove worktree dialog):

- When it opens, it reads the worktree's lock. A locked one gets a warning next to the
  other risks (uncommitted changes, unpushed submodules): "It's locked by supacode:
  removing it overrides the lock." A JSON reason with an `owner` (Supacode's
  `{"owner":"supacode",…}`) reads as "by <owner>"; any other reason shows in parentheses.
- Enter (the dialog's existing consent) removes it with `git worktree remove --force --force`:
  git removes a locked worktree only with `--force` given twice, which also covers
  uncommitted changes and submodules.
- If it got locked after the dialog opened, the first Enter shows "It's locked now…. Enter
  again removes it anyway." instead of removing, like Herdr's own "It changed since this
  opened" for new changes.
- Unlocked worktrees are removed exactly as before.

## What it expects from Herdr's original

`mods/worktree/main.js`. If Herdr renames or rewrites these, put the same behavior where
the equivalent code now lives.

- `submodules(top, on)`, ending `return { mods, unpushed };`: the helpers `lockOf` and
  `lockedBy` go right after it. `lockOf` reads `<git dir>/locked` (git's documented lock
  file; `git rev-parse --absolute-git-dir` in the worktree gives the git dir) with
  `readTextFile`, already imported.
- `init()`: `this.dirty = false;` and `this.unpushed = [];` set the remove dialog's risks;
  `this.locked = null;` goes after them. Later, the remove branch
  `if (repo && props().action === "remove") { … this.unpushed = (await submodules(repo.top, this.on)).unpushed; }`
  reads the lock as its last step.
- `remove()`:
  - `if (changed) return "It changed since this opened. Enter again removes it anyway.";`
    comes before the space is closed (`run("space.close", …)`); the lock re-check goes
    right after it.
  - `const force = this.dirty || mods.length > 0;` and then
    `git(this.repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top], …)`;
    the patch picks `--force --force` for a locked worktree.
- `render()`: the remove warnings `.when(remove && this.dirty, …)` and
  `.when(remove && this.unpushed.length > 0, …)`; the lock warning goes after them, in the
  same `t.blocked` color.

## How to check it works

- `git worktree lock --reason '{"owner":"supacode"}' <worktree>`, then Remove worktree on its
  space: the dialog says "It's locked by supacode: removing it overrides the lock."
- Enter: the space closes, the folder is gone, `git worktree list` no longer shows it.
- An unlocked worktree: no lock warning, removed as before.
