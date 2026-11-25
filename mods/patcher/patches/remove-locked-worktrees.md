# remove-locked-worktrees

Remove worktree handles locked worktrees (Supacode locks the ones it makes): the dialog
warns that it's locked, and Enter removes it anyway, overriding the lock. The dialog's checks
(uncommitted changes, submodules, the lock, the branch) show as a checklist and run side by
side, and Enter works before they're done. The removal itself
(and the branch deletion `project-worktree-settings` asks for) runs in the background, in
`mods/worktree-jobs`, so the dialog closes once the space's programs have stopped, and a toast
says when it's done.

Made on top of: `use-patched-copies` (the space menu opens `my-worktree`) and
`project-worktree-settings`: the checklist replaces the remove dialog's init checks, whose
context is that patch's `worktreeSettings` and `branchOf` lines, and it shows its branch check
(`this.branch`) as a row, so it must apply after it. The background removal and the checklist
live here rather than in their own patches because they replace lines this patch already owns
(the `git worktree remove` line for `--force --force`, the lock check and its warning).

## What it does

In `mods/worktree` → `my-worktree` (the Remove worktree dialog):

- Checklist: the rows show with spinners from the dialog's first frame. Once the repo and
  projects.json are read, `check()` runs the checks at once (`git status`, the submodules, the
  lock, and the branch with `deleteBranch`), each a row: "Uncommitted changes…" while it runs, then
  ✓ "No uncommitted changes" / "No unpushed submodule commits" / "Not locked", or, in the
  `blocked` color, "!" and what's at risk ("It has uncommitted changes: they will be lost.",
  "Submodule … has commits that aren't pushed anywhere: they will be lost.", "It's locked by
  supacode: removing it overrides the lock."), or "✗ Couldn't check …: <error>". With
  `deleteBranch`, a fourth row runs `project-worktree-settings`' `branchOf()` (its `rev-list`
  over every ref takes up to ~0.4 s on a big repo): "Branch <name>'s commits are all on another
  branch or remote", or its "will be lost" warning; a detached checkout has no row. A lock's JSON reason with an
  `owner` (Supacode's `{"owner":"supacode",…}`) reads as "by <owner>"; any other reason shows
  in parentheses.
- `mods/menu` → `my-menu`: Remove worktree opens the dialog at 440×380 (Herdr's worktree
  dialogs are 440×260), so four rows with wrapped warnings fit.
- Enter works as soon as the repo is known (about 0.1 s), without waiting for the checks
  (`git status` takes seconds on a big repo). Enter while they run waits for them:
  - all clean (or only risks already shown when Enter was pressed): it removes, without
    checking again;
  - a risk found after Enter: "It found something at risk. Enter again removes it anyway.";
  - a check failed: "A check failed. Enter again checks again."
- Enter after the checks are done checks again as before (`git status`, submodules, lock, and
  the branch if its check failed), so risk that appeared since the dialog opened gets one more
  warning.
- Enter (the dialog's existing consent) removes it with `git worktree remove --force --force`:
  git removes a locked worktree only with `--force` given twice, which also covers
  uncommitted changes and submodules.
- If it got locked after the checks, the first Enter shows "It's locked now…. Enter
  again removes it anyway." instead of removing, like Herdr's own "It changed since this
  opened" for new changes.
- Unlocked worktrees are removed exactly as before.
- The space closes as in Herdr's dialog (0.1.18): once the checks pass, the dialog closes it
  and waits (up to 10 s) for its terminals to stop, so a running dev server can't write into a
  half-deleted folder. A removal git then refuses leaves the folder, with its space closed:
  Open worktree reopens it.
- Background removal: then the dialog appends a job
  `{ kind: "remove", on, main, top, forced, branch }` to the shared value `worktree-jobs.queue`, and closes.
  `branch` is `this.branch?.name` (set by `project-worktree-settings` when the project has
  `deleteBranch`), else null. Closing the dialog once it's queued (Esc, a click outside) no
  longer stops anything.
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
  `this.locked`, `this.mods`, `this.pending` and `this.failed` go after them. The comment
  "The repo is set last: Enter does nothing until the warnings it consents to are known." is
  reworded (Remove's checks now run on after it). The remove branch
  `if (repo && props().action === "remove") { this.dirty = … status …; this.unpushed = … }`
  (after `project-worktree-settings`' `worktreeSettings` / `branchOf` lines) is replaced by
  `this.checking = this.check(repo, cx)` for a linked worktree; `this.repo = repo;` follows
  as before, so Enter works at once. `project-worktree-settings`' `branchOf` line used to sit
  there too; it's now a check inside `check()`, which needs `this.worktrees` (set by that
  patch's `worktreeSettings` line, right before).
- `submodules(top, on)` returns `{ mods, unpushed }`; `check()` keeps both (`mods` decides
  `--force` when Enter skips the re-check).
- The `View`'s `space()` method: `check()`, `risks()` and `renderChecks()` go right before it.
- `remove(cx)`:
  - It opens with Herdr's re-check: `git status`, `submodules()`, `changed`, then
    `if (changed) return "It changed since this opened. Enter again removes it anyway.";`.
    The patch wraps it (indented) in the `else` of `if (this.pending.size > 0)`, the wait for
    the checks; the lock re-check goes right after `changed`, and `mods` comes from
    either branch.
  - Herdr's own lock check follows it (since 0.1.17): `git worktree list --porcelain`, then
    `if (lock) return … "This worktree is locked." …`, which refuses a locked worktree. The
    patch deletes that block: it would make the warning and `--force --force` unreachable.
  - Herdr then closes the space and waits for its terminals to stop (since 0.1.18: the
    `if (s?.id) { … run("space.close", …) }` block and the `while (… terminals() …)` loop with
    its 10-second deadline). The patch leaves that block as it is, so the space is closed and
    quiet before the job is queued; it shares no lines with it.
  - `const force = this.dirty || mods.length > 0;` and then
    `git(this.repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top], …)`;
    the patch picks `--force --force` for a locked worktree, and replaces that `git` call and
    the `if (!r.ok) return …` after it with the queued job; `return "";` stays.
  - `work()` closes the dialog when `remove()` returns `""`.
- `lockedBy()`'s end is followed by the `queueRemoval()` helper and its own
  `import { shared as sharedValue, setShared as setSharedValue }` (aliased: `sync-new-worktrees`
  imports `shared` and `setShared` under their own names).
- `mods/menu/main.js` `choose(i, cx)`: `if (!it) return;` then
  `closeOverlay(props()?.overlay);` and the `if (it[1] === "worktree") openOverlay({ … width: 440, height: 260 … })`
  line. The Remove case goes between the first two, with its own `closeOverlay`, and returns:
  `new-worktree-opens-claude-new` inserts its New case right after the `closeOverlay` line, so
  this hunk is written with one line of context (`diff -U1`) to stay clear of it.
- `layouts/main.json`: the node `"id": "sidebar-footer"`, `"type": "block"`; the floating
  list goes right after its type. In `sidebar-lists`' children, the `spaces` block (ending with
  `"mod": "my-spaces"` from `use-patched-copies`, the only lines shared with it, as context)
  followed by the `agents` block; the status block goes between them.
- `render()`: the remove warnings `.when(remove && this.dirty, …)` and
  `.when(remove && this.unpushed.length > 0, …)` are replaced by `renderChecks(t)`, shown
  while the repo is unknown or a linked worktree, keeping their
  texts and `t.blocked` color; ✓ uses `t.done`. `div().frames(…)` makes the spinner, as in the
  dialog's own "working…".

## How to check it works

- Remove worktree on a big repo's worktree: three rows with spinners, each turning ✓ on its
  own; the footer says "↵ remove" from the start.
- Remove worktree with every row a red warning (an untracked file, a lock, an unpushed
  branch with `deleteBranch`): every row, the error line and the footer fit in the dialog.
- Enter right away on a clean worktree: "working…" until the checks end, then it's removed.
- Enter right away on a worktree with an untracked file: "It found something at risk. Enter
  again removes it anyway." and the "uncommitted changes" row; Enter again removes it.
- `git worktree lock --reason '{"owner":"supacode"}' <worktree>`, then Remove worktree on its
  space: the lock row says "It's locked by supacode: removing it overrides the lock."
- Enter: the space closes, then the folder goes, and `git worktree list` no longer shows it.
- An unlocked worktree: no lock warning, removed as before.
- `herdr-app status` lists a float `worktree-jobs`.
- While a removal runs, a row "Removing <name> · Ns" shows between Spaces and Agents; it goes
  when the removal is done.
- Remove worktree on a slow-to-delete worktree, Enter: the space and the dialog close at once,
  the "Removing" row shows while git deletes the folder, and a toast "Removed worktree <name>"
  follows (with "Deleted branch … too." when the project deletes branches);
  `git branch --list <name>` is empty.
- A space running a dev server (`python3 -m http.server`): Enter stops it before the folder
  goes; nothing is left behind in the worktree's folder.
- A removal git refuses: an error toast with git's message; the folder stays (its space is
  already closed).
