# space-row-badges

Shows each space's pull request (GitHub) or merge request (GitLab) at the right of its row,
from the status hub's `status.reviews`, and a Claude icon per Claude Code session in the
space right after its name. Adapted from Better Sidebar (github.com/munza/herdr-mods, Apache 2.0).

Made on top of: `use-patched-copies`. Depends on `mods/status-hub` (patch `run-status-hub`),
which finds the PRs/MRs (gh, glab) and publishes them; the copy runs no git, gh or glab.
The Claude icons are in this patch, not one of their own: they go between the name and the
tail, next to the tail line this patch changes for the badge, so separate patches would each
break the other's context.

## What it does

- `my-spaces`: new file `pr-status.js` with the badge only, `prBadge(id, entry, t)`, drawing
  a hub entry `{ branch, items, error? }` (shape in `mods/status-hub/README.md`). Each row
  with an item ends with its icon (`mods/status-hub/icons/<look.icon>.svg`) and `#42`
  (GitHub) or `!42` (GitLab) in `theme()[look.tone]`: green Open, gray Draft, purple Merged,
  red Closed, red Conflicts, red Checks failed, yellow Changes requested, blue Needs approval,
  green Ready to merge (with `✓`). `+N` when the branch has more open ones.
  Right after the number, an open or draft one's CI (`item.ci`): a ring in `theme().working`
  while checks run, a green (`ansi2`) dot once they passed, a red (`ansi1`) one when they failed;
  nothing without CI, and none beside `✓` (ready to merge implies passed). The icon's color
  stays the review state, so a conflicted PR with passing checks is a red icon with a green dot.
  The tooltip names repository, number, `look.label`, the CI line ("Checks running",
  "Checks passed", "Checks failed: <names>") and title. Cmd-click (Ctrl-click off macOS) opens its `url`; a plain
  click still selects the space. When the lookup failed and nothing is known, a dim `PR ?`
  (`MR ?` when the error is glab's: the entry names no host) holds the error in its tooltip;
  a known item stays, marked stale in its tooltip.
- A row shows the hub's entry only while its `branch` equals the row's git branch
  (`g?.branch`), so a branch switch hides the old badge at once, before the hub looks again.
- `my-spaces`, Claude icons: new file `claude-icons.js`, `claudeIcons(space, t)`. For every
  agent in `agents()` whose `space` is the row's and whose `program.key` is `claude`, one
  12px icon (the program table's `program.icon`: `icons/claude.svg` unless `programs.json`
  changes it), 3px apart, in the agents list's order, right after the space's name and
  before its git tail (branch text, counts, ahead/behind), so before the badge too. A
  `blocked` agent's icon (waiting on you) is drawn one color, `theme().blocked` (red); a `done`
  one (finished while you weren't looking) in `theme().done` (blue). `working` keeps the
  program's own look at full opacity, `idle` the same dimmed (opacity 0.4). Only
  agents count: a terminal where Claude has exited (a shell again) has none, and sub-agents
  without a pane aren't in `agents()`. A space with none adds nothing to its row (an empty
  array, so no extra gap). The collapsed rail draws no icons. Clicks on them are the row's.

## What it expects from Herdr's original

- `mods/spaces/main.js`:
  - The `import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared,
    setShared, watchFolder, window, layout } from "herdr";` line: the patch's own import
    goes on the line after it (both imports: `prBadge`, `claudeIcons`). Relies on `shared`
    and `panes` being imported there.
  - `row(...)`: the line
    `.child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),` as the last child of
    the row's `h_flex()`, closing `row()`, right after the name's
    `.child(div().flex_initial()….child(w.name))`. The Claude icons (`claudeIcons(w.id, t)`;
    `w.id` is the real space's id even on a worktree row, where `space-git-tail` copies `w`
    but keeps `id`) go between the two, the badge after the tail, and a `review(w, g)` method
    right after `row()`. It reads `shared("status.reviews")?.[where(w, panes())]`
    with the module-level `where()`. The row's own `on_mouse_down` / `on_mouse_up` drive
    drag and select, so the badge stops modified presses.
- Icon paths are `mods/status-hub/icons/…`, the hub's own.
- `herdr`'s `agents()` with `space` (the same ids as `spaces()`), `status` and `program.key`,
  `program.icon`, `program.tint`.

## How to check it works

- A space on a branch with an open PR shows its icon and number at the right; hovering
  shows the title, state and checks.
- Push to it: a ring follows the number while CI runs, then a green or red dot. A draft with
  CI shows the same dots.
- Cmd-click the number: the PR opens in the browser and the space isn't selected or
  dragged. A plain click selects the space.
- Switch the branch: the old PR disappears at once, the new one (if any) appears.
- `gh auth logout` (or no network): a dim `PR ?` with the error, or the last PR marked
  stale; the list still works. A gitlab.com remote without glab: `MR ?` ("glab not installed").
- A space with two Claude Code sessions shows two Claude icons right after its name, before
  its branch and counts; a space with none shows none, its row as before.
- A session waiting for input shows a dimmed icon; send it a message: full orange while it
  works. One asking permission is red; one that finished in an unselected space is blue,
  then dimmed once you look at it. Exit one (`/exit`): its icon goes.
- Narrow the sidebar under 160px: the rail shows no icons.
