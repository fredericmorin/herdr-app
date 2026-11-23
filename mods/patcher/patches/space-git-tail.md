# space-git-tail

A space row's git tail: the repo/branch right after the name, and the uncommitted line
counts, `+12 −3`, at the right with ahead/behind.

Made on top of: `use-patched-copies`. One patch, not two: the branch's growth and the
counts' insertion are adjacent lines of the same chain in `gitTail`, so separate patches
would each break the other's context.

## What it does

- `my-spaces`, branch beside the name: the tail's repo · branch text grows to fill the
  row (`flex_1`), so it sits right after the name and everything after it is pushed to
  the right edge. What it shows is unchanged: master, main and a branch repeating the
  name still go unsaid. A PR badge after the tail (`space-pr-status`) stays at the right.
- `my-spaces`, worktrees: a worktree row (nested under its repo's space) reads as its
  branch in the name's place, with the space's own name in the tail's dim branch spot:
  `feature/login  test3`. Unchanged when the branch is the space's name or detached. Only
  the drawn row changes: the PR lookup, the menu and drag still use the real space and
  branch.
- `my-spaces`, line counts: `added` / `removed` from shared `status.git` (the status
  hub's `git diff --numstat HEAD`: uncommitted lines, staged and unstaged; untracked files
  aren't counted, a repo with no commit yet shows none). The tail shows them as green `+N`
  and red `−N` before ahead/behind, only when not zero. The patch computes nothing.
- The counts refresh when the hub's do: after a command or an agent's turn ends, on any
  change in the repo's git folder, and on its 60-second fallback. Saving a file alone
  doesn't refresh them. `this.git` is the hub's map through `spaces-git-from-hub`.

## What it expects from Herdr's original

- `mods/spaces/main.js`: `g` (a row's `this.git[where(…)]` entry) carries `added` and
  `removed`; they come from `status.git` (`mods/status-hub/README.md`).
- `row({ w, i, g, tree }, t)`: destructured parameters it may reassign at its top, with
  the name drawn from `w.name` and `g` passed on to `gitTail`. The patch replaces `w` and
  `g` with copies for a worktree row (`tree` set): `w.name` becomes `g.branch`, and
  `g.worktree` carries the space's name. The copies keep every other field, so
  `space-pr-status`'s badge (which reads `g?.branch` and `place(w, …)`) still matches.
- `gitTail(g, tree, name, t)`: the line
  `const where = [repo, branch].filter(Boolean).join(" · ");`, which becomes
  `g.worktree ?? …`. Also a `flex_auto()` `h_flex()` chain containing
  `.when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))`
  directly followed by `.when(g.ahead > 0, …)`. The patch adds `.flex_1()` to that `div`
  and the two counts between the lines.

## How to check it works

- A space on a feature branch shows the branch just after its name; counts and
  ahead/behind are at the right edge, the PR badge (if any) last.
- Edit a tracked file in a space's repo and run any command there: the row shows `+N −M`
  matching `git diff --numstat HEAD`. Commit or revert: the counts go away.
- `herdr-app status` shows no errors.
