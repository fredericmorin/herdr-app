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
- Background creation: New worktree doesn't run `git worktree add` itself. It appends a job
  `{ kind: "add", on, top, add, path, tab, argv }` to the shared value `worktree-jobs.queue`
  and closes; `mods/worktree-jobs` (floated by `remove-locked-worktrees`) runs the add, then
  `space.new` with that `argv`, and posts an error toast if git refuses. Closing the dialog
  early no longer leaves a worktree with no space. It's here because it replaces the
  `space.new` line this patch already owns (for the setup).
- `deleteBranch: true`: Remove worktree also deletes the worktree's branch with
  `git branch -D`, after `git worktree remove` succeeds. This patch reads the setting and
  provides `branchOf()`; `remove-locked-worktrees` calls it as one of the dialog's checks (into
  `this.branch`) and hands the branch to the background removal
  (`mods/worktree-jobs`), which deletes it and says so in its toast. The dialog says "Deletes
  branch <name> too." instead of "The branch stays." ("Deletes its branch too." while the
  check runs). `this.branch.unpushed` says whether the
  branch has commits on no other local branch and no remote (they will be lost);
  `remove-locked-worktrees` shows that as a row of its checklist. A detached checkout has no
  branch to delete.
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
  (`!this.opening`; Remove gets no `dir`). `remove-locked-worktrees` starts its checks (the
  branch one among them) right after that line.
- `repoOf(folder, on)` returns `{ top, main, name, linked }`, `main` being the main
  checkout's absolute path; projects.json keys are compared with it. `readTextFile` and
  `appHome` are already imported.
- `create()`: `const path = \`${this.root}/${this.repo.name}/${slug(branch)}\`;`, the
  `exists` / `add` lines (git's arguments), then
  `const r = await git(this.repo.top, add, this.on, 600_000);`, its `if (!r.ok) return …`,
  `const p = props();`, the comment "Leave spaces unnamed…", and
  `run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });`.
  The patch replaces the git call through `space.new` with the queued job.
- `branchOf()`'s end is followed by `queueCreation()` and its own
  `import { shared as readShared, setShared as writeShared }` (aliased: `sync-new-worktrees`
  and `remove-locked-worktrees` import them too).
- `render()`: the New description string starting "A new space on a checkout in
  ${tilde(this.root, this.userHome)}/${r.name}/." and the Remove one ending "The branch stays.".
  The unpushed-branch warning isn't here: it's a row of `remove-locked-worktrees`' checklist.

## How to check it works

- The patcher window shows `my-worktree` up to date or updated.
- New worktree in a repo listed in projects.json: the dialog names the project's folder, the
  checkout lands in `<directory>/<branch-slug>`, the setup's output shows in the new space's
  terminal and a shell prompt follows.
- New worktree on a big repo, Enter, and click outside at once: the space still opens when git
  is done. A branch git refuses (already checked out elsewhere): an error toast.
- New worktree in a repo not listed: Herdr's usual folder, no setup.
- Break projects.json (a stray comma): New worktree shows "projects.json: …" and makes nothing.
- `"deleteBranch": true` on a project, Remove worktree on one of its worktrees: the dialog says
  "Deletes branch <name> too."; Enter removes the folder and `git branch --list <name>` is empty.
  Top-level `"worktrees": { "deleteBranch": true }`: the same for a repo not listed; a project
  with `"deleteBranch": false` keeps its branch.
  A branch with a commit that isn't pushed or on another branch shows the "will be lost"
  row in the checklist (`remove-locked-worktrees`). A project without it: "The branch stays." and the branch remains.
