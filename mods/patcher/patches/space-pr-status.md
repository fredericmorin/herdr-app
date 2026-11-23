# space-pr-status

Shows each space's pull request (GitHub) or merge request (GitLab) at the right of its row,
from the status hub's `status.reviews`. Adapted from Better Sidebar (github.com/munza/herdr-mods,
Apache 2.0).

Made on top of: `use-patched-copies`. Depends on `mods/status-hub` (patch `run-status-hub`),
which finds the PRs/MRs (gh, glab) and publishes them; the copy runs no git, gh or glab.

## What it does

- `my-spaces`: new file `pr-status.js` with the badge only, `prBadge(id, entry, t)`, drawing
  a hub entry `{ branch, items, error? }` (shape in `mods/status-hub/README.md`). Each row
  with an item ends with its icon (`mods/status-hub/icons/<look.icon>.svg`) and `#42`
  (GitHub) or `!42` (GitLab) in `theme()[look.tone]`: green Open, gray Draft, purple Merged,
  red Closed, red Conflicts, red Checks failed, yellow Changes requested, green Ready to merge
  (with ` ✓`). `+N` when the branch has more open ones. The tooltip names repository,
  number, `look.label` and title. Cmd-click (Ctrl-click off macOS) opens its `url`; a plain
  click still selects the space. When the lookup failed and nothing is known, a dim `PR ?`
  (`MR ?` when the error is glab's: the entry names no host) holds the error in its tooltip;
  a known item stays, marked stale in its tooltip.
- A row shows the hub's entry only while its `branch` equals the row's git branch
  (`g?.branch`), so a branch switch hides the old badge at once, before the hub looks again.

## What it expects from Herdr's original

- `mods/spaces/main.js`:
  - The `import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared,
    setShared, watchFolder, window, layout } from "herdr";` line: the patch's own import
    goes on the line after it. Relies on `shared` and `panes` being imported there.
  - `row(...)`: the line
    `.child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),` as the last child of
    the row's `h_flex()`, closing `row()`; the badge is added after it, and a `review(w, g)`
    method right after `row()`. It reads `shared("status.reviews")?.[where(w, panes())]`
    with the module-level `where()`. The row's own `on_mouse_down` / `on_mouse_up` drive
    drag and select, so the badge stops modified presses.
- Icon paths are `mods/status-hub/icons/…`, the hub's own.

## How to check it works

- A space on a branch with an open PR shows its icon and number at the right; hovering
  shows the title and state.
- Cmd-click the number: the PR opens in the browser and the space isn't selected or
  dragged. A plain click selects the space.
- Switch the branch: the old PR disappears at once, the new one (if any) appears.
- `gh auth logout` (or no network): a dim `PR ?` with the error, or the last PR marked
  stale; the list still works. A gitlab.com remote without glab: `MR ?` ("glab not installed").
