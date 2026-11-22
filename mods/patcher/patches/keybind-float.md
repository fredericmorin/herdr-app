# keybind-float

Keeps the `keybind` mod running in `my-main`, so a `keybind.<name>` key in `keys.json` runs the
first rule of `<name>` in `mods/keybind/binds.json` that fits what the window shows, whatever
has the keyboard. For example `cmd-n` (`keybind.new`, in `layout:my-main`) opens a new To-Do
ticket while the Vikunja board shows, and makes a new space otherwise.

Made on top of: `use-patched-copies` (only for consistency: it touches no line of the base).

## What it does

- `layouts/my-main.json`: the `work` column gets a `floating` list holding a `keybind` block.
  The mod draws nothing (0×0); it only has to stay loaded to get `keybind.<name>` (a
  `<mod>.<command>` reaches loaded, shown copies only). On `work` rather than the root's
  `floating` list (`sync-new-worktrees` changes it) or `status`'s (`tab-history-float`).
- Depends on `mods/keybind` (rules in its `binds.json`; `if.shown` checks a layout node is on
  screen through `layout()`, `do` runs a command, `<mod>.<command>` included) and on the
  `keybind.*` bindings in `keys.json`. The shipped `cmd-n` rule also uses `board-toggle`'s
  `board` node and `mods/vikunja-board`'s `new` command.

## What it expects from Herdr's original

- `layouts/main.json`: a node with `"id": "work",` followed directly by `"type": "column",`
  and `"resizable": false,`, and no `floating` key of its own. Any node that is always in the
  layout and never hidden works if `work` goes away (not the sidebar: `cmd-b` hides it).

## How to check it works

1. `herdr-app status`: `floats` lists `keybind`.
2. On the terminals, press `cmd-n`: a new space opens, as before.
3. Press `cmd-2` (the Board), then `cmd-n` without clicking: the New task dialog opens for To-Do.
4. Click a terminal pane first, then `cmd-2` and `cmd-n`: the dialog opens all the same.
