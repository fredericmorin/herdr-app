# worktree-progress

When a caller names the branch and asks for progress only, the worktree dialog shows just
"Creating worktree <branch>" with a spinner until it hands the creation off, instead of the
full New worktree form that creates by itself and closes. (With `project-worktree-settings`,
`git worktree add` runs in the background, so this is only the dialog's own loading.)

Made on top of: `use-patched-copies`.

## What it does

- `my-worktree`: props `{ progress: true, branch, … }` render `renderProgress()` (title,
  spinner, repo name) instead of the form. An error, or a folder that isn't in a repo,
  brings the form back with the error, and the keyboard moves to its branch input, so the
  branch can be fixed and Enter pressed. git's own refusals come later, as a toast from
  `mods/worktree-jobs`. Esc still closes.
- Depends on it: `mods/worktree-request` passes `progress: true` (for claude-new,
  claude-fork and scripts' requests).

## What it expects from Herdr's original

- `mods/worktree/main.js`:
  - `init()`'s loading task ends with
    `if (props().action !== "remove") cx.timer.after(100, () => this.input.focus());`
    followed by `if (props().branch) await this.work(cx);` (a branch in props creates at
    once). The patch skips that focus for progress (the input isn't mounted, and focusing
    it would take the keyboard off the root, so Esc would stop working) and focuses the
    input after an error.
  - `work()` leaves the error in `this.error` and closes the dialog on success.
  - `render(cx)` starts with `const t = theme();` and
    `if (this.opening) return this.renderOpen(t);`, with `renderOpen(t)` right before it.
  - `this.handle` (root focus handle), `this.key(e, cx)` (Esc closes), `this.text` (the
    branch), `this.repo` (`undefined` while loading, `null` when not a repo, else `{ name }`).

## How to check it works

1. claude-new, New worktree, a branch, Enter: after "Opening worktree…", the dialog shows
   "Creating worktree <branch>" with a spinner, then closes and the space opens.
2. Break `projects.json` (a stray comma) and repeat: the form comes back with the
   "projects.json: …" error and the branch input focused.
3. The space menu's plain worktree dialog (Open, Remove) is unchanged.
