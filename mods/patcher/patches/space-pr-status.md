# space-pr-status

Shows each space's GitHub pull request at the right of its row, from the local `gh`.
Adapted from Better Sidebar (github.com/munza/herdr-mods, Apache 2.0).

Made on top of: `use-patched-copies`.

## What it does

- `my-spaces`: new files `pr-status.js` (discovery and the badge) and `pr-icons/*.svg`
  (pull-request, draft, merged, closed). Each row with a PR ends with its icon and
  `#42` in the PR's state color: green Open, gray Draft, purple Merged, red Closed,
  red Conflicts, red Checks failed, yellow Changes requested, green Ready to merge
  (with ` ✓`). `+N` when the branch has more open PRs. The tooltip names repo, number,
  title and state. Cmd-click (Ctrl-click off macOS) opens the PR; a plain click still
  selects the space. When gh fails and nothing is known, a dim `PR ?` holds the error in
  its tooltip; a known PR stays, marked stale in its tooltip, for the same branch only.
- Discovery: git on the space's machine reads the branch, an optional
  `branch.<b>.herdr-pr` (`owner/repo#42`) binding, and the github.com remotes; `gh pr
  list --head <branch> --state all` runs locally per remote, keeps only heads from this
  checkout's own remotes, prefers open PRs, else the newest. Each checkout is looked at
  once a minute, or at once when its branch changes. Detached, non-git and non-GitHub
  checkouts show nothing.

## What it expects from Herdr's original

- `mods/spaces/main.js`:
  - The `import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared,
    setShared, watchFolder, window, layout } from "herdr";` line: the patch's own import
    goes on the line after it.
  - `init`: the line `this.machines = [];`, after which the observer is made.
  - `checkNew(cx)`: `const sp = spaces();` earlier in it and the line
    `if (due.size) this.refreshGit(due, cx);`, after which it reads `panes()` and calls
    `this.prs.refresh(...)` with each space's machine, `place(s, ps)` and
    `this.git[where(s, ps)]?.branch`. Relies on the module-level `place` and `where`
    helpers and `this.git` entries having `branch`.
  - `row(...)`: the line
    `.child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),` as the last child of
    the row's `h_flex()`; the badge is added after it. The row's own `on_mouse_down` /
    `on_mouse_up` drive drag and select, so the badge stops modified presses.
- Icon paths are `mods/my-spaces/pr-icons/…`: the copy's name, not the original's.

## How to check it works

- A space on a branch with an open PR shows its icon and number at the right; hovering
  shows the title and state.
- Cmd-click the number: the PR opens in the browser and the space isn't selected or
  dragged. A plain click selects the space.
- Switch the branch: the old PR disappears at once, the new one (if any) appears.
- `gh auth logout` (or no network): a dim `PR ?` with the error, or the last PR marked
  stale; the list still works.
