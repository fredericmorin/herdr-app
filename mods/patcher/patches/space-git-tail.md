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
- `my-spaces`, line counts: each git read of a space's checkout also runs
  `git --no-optional-locks -c core.fsmonitor=false diff --numstat HEAD` there (on the
  space's machine) and sums added and removed lines, staged and unstaged. The tail shows
  them as green `+N` and red `−N` before ahead/behind, only when not zero. Untracked files
  aren't counted; a repo with no commit yet shows none.
- The counts refresh with the rest of the row's git: after a command or an agent's turn
  ends, on any change in the repo's git folder, and on the list's 60-second fallback.
  Saving a file alone doesn't refresh them.

## What it expects from Herdr's original

- `mods/spaces/main.js`, `check(key, cx)`: the lines
  `const info = { name, branch: …, ahead, behind, repo: …, linked: … };` then
  `this.git[key] = info;` and `if (!on) this.watch(repo, cx);`. The diff read goes between
  `info` and `this.git[key] = info;`, so `info` must be a plain object built before it's
  stored, with `exec`, `cwd` and `on` in scope. Nothing may write the index during the
  read: the list watches each local repo's git folder, and an index write would refresh
  it again, in a loop.
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
- `herdr-app status` shows no errors and the list doesn't keep refreshing (no CPU spin).
