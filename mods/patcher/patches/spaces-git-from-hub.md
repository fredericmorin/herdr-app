# spaces-git-from-hub

The spaces sidebar takes each space's git facts from the status hub instead of running git
itself.

Made on top of: `use-patched-copies`.

## What it does

- `my-spaces`: `this.git` (where() → `{ name, branch, ahead, behind, repo, linked, top,
  added, removed }`, `null` for not a repo) is now a read-only view of shared `status.git`,
  published by `mods/status-hub` (contract in `mods/status-hub/README.md`). my-spaces runs
  no git, sets no repo watch and has no git timer any more; it re-renders on every shared
  state change, so its rows follow the hub at once.
- What the rows show is unchanged: repo · branch, ahead/behind, worktrees nested under
  their repo's space, and new spaces still wait (at most 1.5 s, the `born` wait in
  `ordered()`) until the hub has looked at their place, so a worktree lands under its repo
  without jumping.
- The `+N −M` counts (`space-git-tail`) and the PR/MR badge (`space-pr-status`) read
  the same hub data. `mods/status-hub` must be running (patch `run-status-hub`), or every
  row shows no git.
- `due`, `refreshGit`, `check` and `watch` stay in the copy, unused: deleting them would
  make a large patch that breaks on every Herdr update to that code. They're the only
  writers of `this.git`, and nothing calls them now (writing into the getter-only property
  would throw).

## What it expects from Herdr's original

- `mods/spaces/main.js`:
  - `shared` imported from `"herdr"` (it is, in the module's one herdr import).
  - `init`: the line
    `this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo`,
    replaced with `Object.defineProperty(this, "git", { get: () => shared("status.git") ?? {} })`.
  - `checkNew(cx)`: the two lines `const due = this.due(now, sp, panes());` and
    `if (due.size) this.refreshGit(due, cx);`, removed. They're the only start of git reads:
    `refreshGit` is otherwise called only from `watch`, which only `check` starts.
  - Every reader uses `this.git[where(s, ps)]` with the module-level `where()`/`place()`,
    which the hub copies exactly (its keys must stay equal), and `ordered()`'s readiness
    `where(w, ps) in this.git`.
  - If Herdr adds another writer of `this.git`, it throws (getter only): find it with
    `grep -n "this\.git" mods/my-spaces/main.js`.

## How to check it works

- `grep -nE 'refreshGit\(due' ~/.config/herdr-app/mods/my-spaces/main.js` prints nothing.
- The sidebar shows the same repo · branch, ahead/behind and worktree nesting as before.
- Check out another branch in a space: the row changes within a second or two (the hub's
  refresh after the command ends).
- `git worktree add` + a new space there: it appears under its repo without jumping.
- `herdr-app status` shows no errors.
