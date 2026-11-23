# run-status-hub

Keeps the `status-hub` mod running in `my-main`, so each space's git facts, worktrees and
PR/MR status are fetched once and published as shared `status.*` keys.

Made on top of: `use-patched-copies` (it touches no line of the base: the base changes the
`tabs` block's `"mod"` line, this patch adds lines right after its `"type"` line).

## What it does

- `layouts/my-main.json`: the `tabs` block gets its own `floating` list holding a
  `status-hub` block. The mod draws nothing (0×0); it only has to stay alive. On `tabs`
  because it is always shown, and because `sync-new-worktrees` and `tab-history-float`
  already change the root's and the `status` block's `floating` lines.
- Depends on `mods/status-hub` (its README is the key contract). Readers of `status.git`,
  `status.worktrees` and `status.reviews` get nothing while this float is missing.

## What it expects from Herdr's original

- `layouts/main.json`: a block with `"id": "tabs"` followed directly by
  `"type": "block",` and then `"size": { "px": 42 }`, and no `floating` key of its own.
  Any block that is always in the layout works if `tabs` goes away.

## How to check it works

1. `herdr-app status`: `floats` lists `status-hub` with 0×0 bounds.
2. `jq 'keys' ~/.config/herdr-app/shared.json` lists `status.git`, `status.worktrees` and
   `status.reviews`.
3. Edit a tracked file in a space and run a command there: that space's `added` in
   `status.git` changes within a second or two.
