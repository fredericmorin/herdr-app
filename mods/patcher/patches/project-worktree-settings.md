# project-worktree-settings

New worktree reads per-project settings from `~/.config/herdr-app/projects.json`: where
the project's worktrees go and a setup script to run in each new one.

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
- A repo with no entry keeps Herdr's folder and runs no setup.
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
  settings right after `const repo = await repoOf(this.folder, this.on);`, only when
  `this.root` is set.
- `repoOf(folder, on)` returns `{ top, main, name, linked }`, `main` being the main
  checkout's absolute path; projects.json keys are compared with it. `readTextFile` and
  `appHome` are already imported.
- `create()`: `const path = \`${this.root}/${this.repo.name}/${slug(branch)}\`;`, then after
  `git worktree add`: `const p = props();`, the comment "Leave spaces unnamed…", and
  `run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });`.
- `render()`: the New description string starting "A new space on a checkout in
  ${tilde(this.root, this.userHome)}/${r.name}/.".

## How to check it works

- The patcher window shows `my-worktree` up to date or updated.
- New worktree in a repo listed in projects.json: the dialog names the project's folder, the
  checkout lands in `<directory>/<branch-slug>`, the setup's output shows in the new space's
  terminal and a shell prompt follows.
- New worktree in a repo not listed: Herdr's usual folder, no setup.
- Break projects.json (a stray comma): New worktree shows "projects.json: …" and makes nothing.
