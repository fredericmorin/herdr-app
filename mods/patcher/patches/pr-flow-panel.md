# pr-flow-panel

Docks the PR Flow panel (`mods/pr-flow`, from github.com/jjangsky/herdr-pr-flow, MIT) at
the right edge of `my-main`.

Made on top of: `use-patched-copies`.

## What it does

- `layouts/main.json` → `my-main.json`: a last child of the root row, the block
  `pr-flow` (340px, resizable 280–600px), showing the `pr-flow` mod with its default props.
  It sits right of the `work` column, after the root's divider.
- `mods/pr-flow` itself isn't a copy of Herdr's: it's vendored as-is, with one local
  change (below). The patch only gives it a place: `my-main` is rebuilt at every start, so
  the block the mod docks into on its first load would otherwise be dropped.
- Local change to `mods/pr-flow/main.js`: `init` sets `this.update` to
  `{ ...this.loadUpdate(), off: true }`, so the daily
  `gh api repos/jjangsky/herdr-pr-flow/releases/latest` never runs on its own and settings
  shows checks as off. Its `Check for new versions` toggle still turns them on until the
  next reload. Redo this after copying a newer release over the folder.

## What it expects from Herdr's original

- `layouts/main.json`: the root is a `row` whose `children` end with the `work` column,
  and the file ends with that column's closing `}`, the children's `]` and the root's `}`
  in Herdr's formatting (2-space indent). The block goes after the last root child; if
  Herdr adds root children after `work`, keep `pr-flow` last so it stays at the right edge.

## How to check it works

- The patcher window shows `pr-flow-panel` ✓ applied; `layouts/my-main.json` has one
  `pr-flow` block as the root's last child.
- `herdr-app check ~/.config/herdr-app/mods/pr-flow` passes.
- The panel shows at the right of the window; an agent on a branch with an open PR makes
  a card appear.
- Its settings screen shows the version with no update notice, and no
  `releases/latest` call is made.
