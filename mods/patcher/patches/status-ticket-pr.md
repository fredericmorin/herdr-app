# status-ticket-pr

The bottom status bar shows the focused space's ticket and its pull/merge request, read
from the status hub.

Made on top of: `use-patched-copies` alone (the base only points the `status` block at
`my-workspace-status`; this patch is the only one on that copy).

## What it does

- `mods/workspace-status` → `my-workspace-status`, after the branch label:
  - **PR/MR**: the first item of `status.reviews[where]` for the focused space's `where`
    (from `status.focused`), only while the entry's `branch` equals
    `status.git[where].branch`. Its icon (`mods/status-hub/icons/<look.icon>.svg`), `#N`
    (GitHub) or `!N` (GitLab), `look.label`, and "· checks pending" while CI runs, in the
    theme color `look.tone`. Tooltip: the title and any failed check names. Click opens
    it in the browser. An entry with no item but an `error` shows a dim `PR ?` / `MR ?`
    (MR when the error names glab or GitLab) with the error as tooltip.
  - **Ticket**: `status.focused.ticket`: the Board icon (`mods/status-hub/board.svg`, a
    copy of the issue-board's), `<ref> <title> · <column>`, truncated (at most 420 px, and
    it shrinks first on a narrow window so the palette hint stays). Tooltip: the full text.
    Click runs `layout.select {stack: "center", child: "board"}` (the Board, from
    `board-toggle`).
  - Neither item takes a place in the bar when there is nothing to show.
- Depends on `mods/status-hub` (`status.focused`, `status.reviews`, `status.git`; see its
  README) and its `run-status-hub` float. Without the hub, the bar looks like Herdr's.

## What it expects from Herdr's original

- `mods/workspace-status/main.js`:
  - The import line `import { spaces, agents, theme, run, window, keys } from "herdr";`
    (`shared` is added to it).
  - A `render()` method starting with `const t = theme();`, `const space = …`, `const list`,
    `const needs`, then `const label = (icon, text) => …`; the two items are built right
    before `label`.
  - The bar's chain with `.when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))`
    followed by the agents count `.child(h_flex()…)`: the two items go between them.
  - The bar is an `h_flex` with `gap(16)` and text size 11.8, a `div().flex_1()` spacer
    and the palette hint last.
  - The `hint(t)` method sits right before `render()`; the new `review(t)` and `ticket(t)`
    methods go between them.
- `layouts/main.json`: a `status` block showing `workspace-status` (the base points it at
  the copy), and `board-toggle`'s `center` stack with a `board` child.

## How to check it works

1. The patcher window shows every patch ✓; `mods/my-workspace-status/GENERATED.md` lists
   `use-patched-copies` and `status-ticket-pr`.
2. `herdr-app status`: the `status` block shows `my-workspace-status`, no errors.
3. Focus a session started from the Board: the bar shows its ref, title and column; a
   click shows the Board.
4. A space on a branch with an open PR shows `#N` and its state in its tone; a click opens
   the PR. A space without one shows neither item.
5. Narrow the window: the ticket title truncates and the palette hint stays at the right.
