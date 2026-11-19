# remove-locked-worktrees

Remove worktree handles locked worktrees (Supacode locks the ones it makes): the dialog
warns that it's locked, and Enter removes it anyway, overriding the lock. The removal itself
(and the branch deletion `project-worktree-settings` asks for) runs in the background, in
`mods/worktree-jobs`, so the dialog closes at once and a toast says when it's done.

Made on top of: `use-patched-copies` (the space menu opens `my-worktree`). The background
removal lives here rather than in its own patch because it replaces the `git worktree remove`
line this patch already owns (for `--force --force`).

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
- Background removal: once the checks pass, the dialog closes the space, appends a job
  `{ kind: "remove", on, main, top, forced, branch }` to the shared value `worktree-jobs.queue`, and closes.
  `branch` is `this.branch?.name` (set by `project-worktree-settings` when the project has
  `deleteBranch`), else null. Closing the dialog early (Esc, a click outside) no longer stops
  anything.
- `my-main.json`: a floating block `worktree-jobs` on the `sidebar-footer` node (not the root,
  whose floating list `use-patched-copies` and `sync-new-worktrees` own). It draws nothing.
- `my-main.json`: a block `worktree-jobs-status` in `sidebar-lists`, between `spaces` and
  `agents`, `"hidden": true`, 32 px, showing `mods/worktree-jobs-status` (a personal mod).
  `worktree-jobs` shows it while jobs run (`layout.show`, `layout.resize` to a 24 px row per
  job plus 8) and hides it when the last one ends; it lists them ("⠋ Removing qqq · 12s") from
  the shared value `worktree-jobs.running`. It's a separate block from the runner because a
  hidden block's mod doesn't start until it's first shown.
- `mods/worktree-jobs` (a personal mod, not a copy; it also runs `project-worktree-settings`'
  creations) takes the queue every 500 ms, runs
  `git worktree remove <forced> <top>` in `main`, then `git branch -D <branch>`, and posts a
  toast: "Removed worktree <name>" (success, "Deleted branch … too."), or the git error.

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
    the patch picks `--force --force` for a locked worktree, and replaces that `git` call and
    the `return r.ok ? "" : …` after it with the queued job and `return "";`.
  - `work()` closes the dialog when `remove()` returns `""`.
- `lockedBy()`'s end is followed by the `queueRemoval()` helper and its own
  `import { shared as sharedValue, setShared as setSharedValue }` (aliased: `sync-new-worktrees`
  imports `shared` and `setShared` under their own names).
- `layouts/main.json`: the node `"id": "sidebar-footer"`, `"type": "block"`; the floating
  list goes right after its type. In `sidebar-lists`' children, the `spaces` block (ending with
  `"mod": "my-spaces"` from `use-patched-copies`, the only lines shared with it, as context)
  followed by the `agents` block; the status block goes between them.
- `render()`: the remove warnings `.when(remove && this.dirty, …)` and
  `.when(remove && this.unpushed.length > 0, …)`; the lock warning goes after them, in the
  same `t.blocked` color.

## How to check it works

- `git worktree lock --reason '{"owner":"supacode"}' <worktree>`, then Remove worktree on its
  space: the dialog says "It's locked by supacode: removing it overrides the lock."
- Enter: the space closes, the folder is gone, `git worktree list` no longer shows it.
- An unlocked worktree: no lock warning, removed as before.
- `herdr-app status` lists a float `worktree-jobs`.
- While a removal runs, a row "Removing <name> · Ns" shows between Spaces and Agents; it goes
  when the removal is done.
- Remove worktree on a slow-to-delete worktree, Enter: the dialog closes at once, the space is
  gone, and a toast "Removed worktree <name>" follows (with "Deleted branch … too." when the
  project deletes branches); `git branch --list <name>` is empty.
- A removal git refuses: an error toast with git's message.
