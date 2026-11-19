# project-worktree-settings

New / Remove worktree read per-project settings from `~/.config/herdr-app/projects.json`:
where the project's worktrees go, a setup script to run in each new one, and whether
removing a worktree also deletes its branch.

Made on top of: `use-patched-copies` (the menus open `my-worktree`).

## What it does

In `mods/worktree` → `my-worktree` (the New / Open / Remove worktree dialog):

- Finds the project by the repo's main checkout path:
  `projects["~/project/app"].worktrees` (keys may start with `~/`).
- `directory`: New worktree creates `<directory>/<branch slug>` instead of Herdr's
  `<settings.json worktrees.directory>/<repo>/<branch slug>`. The dialog's description
  names that folder.
- `setup`: runs with `sh -c` in the new space's first terminal (passed as `space.new`'s
  `argv`), so its output shows there; a shell stays open after it. If the caller passed its
  own `argv` (an agent), that starts after the setup.
- `deleteBranch: true`: Remove worktree also deletes the worktree's branch with
  `git branch -D`, after `git worktree remove` succeeds. The dialog says "Deletes branch
  <name> too." instead of "The branch stays.", and warns in the `blocked` color when the
  branch has commits on no other local branch and no remote (they will be lost). A detached
  checkout has no branch to delete. If the branch won't delete, the worktree is already gone,
  so it's a toast ("Couldn't delete branch …"), not a dialog error.
- A top-level `"worktrees": { "deleteBranch": true }` (beside `projects`) is the default for
  every repo; a project's own `deleteBranch` (true or false) wins. It's the only default.
- A repo with no entry keeps Herdr's folder and runs no setup; it deletes branches only when
  the top-level default says so.
- `projects.json` may contain `//` and `/* */` comments (`uncomment()` blanks them outside
  strings, keeping line numbers for parse errors).
- At every start, `mods/patcher/projects.js` (outside this patch) creates `projects.json`
  if it's missing and adds or refreshes the commented reference at its top. **When this patch
  adds or changes a setting, update `REFERENCE` in `projects.js` in the same change.**
- An invalid `projects.json` or value shows as an error in the dialog; nothing is created.

## What it expects from Herdr's original

`mods/worktree/main.js`. If Herdr renames or rewrites these, put the same behavior where
the equivalent code now lives.

- `root(userHome)`: reads settings.json's `worktrees.directory`; the helpers `absolute` and
  `worktreeSettings` are inserted right after it, before the `tilde` helper ("Home as ~").
- `init()` sets `this.root` only for the New flow (not open or remove); the patch loads the
  settings right after `const repo = await repoOf(this.folder, this.on);` for New and Remove
  (`!this.opening`; Remove gets no `dir`), and for Remove with `deleteBranch` reads the branch
  (`branchOf`) into `this.branch`.
- `work()`: `this.busy = false;` then `if (!this.error) this.close();`; the branch deletion
  (`deleteBranch()`, a method inserted right before `async work(cx)`) goes between them.
  It can't go at the end of `remove()` (`remove-locked-worktrees` owns those lines) nor on
  `work()`'s `try` line (`sync-new-worktrees`). `notify` is imported on its own as `notice`,
  next to `branchOf`, because `open-all-worktrees` adds `notify` to the main import line.
- `repoOf(folder, on)` returns `{ top, main, name, linked }`, `main` being the main
  checkout's absolute path; projects.json keys are compared with it. `readTextFile` and
  `appHome` are already imported.
- `create()`: `const path = \`${this.root}/${this.repo.name}/${slug(branch)}\`;`, then after
  `git worktree add`: `const p = props();`, the comment "Leave spaces unnamed…", and
  `run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });`.
- `render()`: the New description string starting "A new space on a checkout in
  ${tilde(this.root, this.userHome)}/${r.name}/.", the Remove one ending "The branch stays.",
  and `.when(Boolean(this.error), …)`, before which the unpushed-branch warning goes (after
  the New input, which Remove doesn't show, so it sits under the other remove warnings).

## How to check it works

- The patcher window shows `my-worktree` up to date or updated.
- New worktree in a repo listed in projects.json: the dialog names the project's folder, the
  checkout lands in `<directory>/<branch-slug>`, the setup's output shows in the new space's
  terminal and a shell prompt follows.
- New worktree in a repo not listed: Herdr's usual folder, no setup.
- Break projects.json (a stray comma): New worktree shows "projects.json: …" and makes nothing.
- `"deleteBranch": true` on a project, Remove worktree on one of its worktrees: the dialog says
  "Deletes branch <name> too."; Enter removes the folder and `git branch --list <name>` is empty.
  Top-level `"worktrees": { "deleteBranch": true }`: the same for a repo not listed; a project
  with `"deleteBranch": false` keeps its branch.
  A branch with a commit that isn't pushed or on another branch shows the "will be lost"
  warning first. A project without it: "The branch stays." and the branch remains.
