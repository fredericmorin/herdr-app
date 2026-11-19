# tab-history-float

Keeps the `tab-history` mod running in `my-main`, so `ctrl--` (`tab-history.back` in
`keys.json`) goes back to the previously shown tab, like VS Code's Go Back.

Made on top of: `use-patched-copies` (only for consistency: it touches no line of the base).

## What it does

- `layouts/my-main.json`: the `status` block gets its own `floating` list holding a
  `tab-history` block. The mod draws nothing (0×0); it only has to stay alive to see
  every tab switch. On `status` rather than the root's `floating` list because
  `sync-new-worktrees` changes that list's lines.
- Depends on `mods/tab-history` (its `main.js` records the tabs left and selects the
  previous one on `back`) and the `ctrl--` binding in `keys.json`.

## What it expects from Herdr's original

- `layouts/main.json`: a block with `"id": "status"` followed directly by
  `"type": "block",` and then `"size": { "px": 28 }`, and no `floating` key of its own.
  Any block that is always in the layout works if `status` goes away.

## How to check it works

1. `herdr-app status`: `floats` lists `tab-history`.
2. Switch to a tab in another space, press `ctrl--`: the tab you were on is shown again.
3. Press `ctrl--` again: it keeps going back through the tabs you left.
