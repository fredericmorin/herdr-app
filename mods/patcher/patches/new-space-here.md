# new-space-here

New space starts where you are: the focused terminal's folder, else the shown space's
first terminal's, instead of what Herdr picks when the focus isn't on a terminal (the folder
the space was made in, or home).

Made on top of: `use-patched-copies`. Copied from flozero/herdr-mods (made there on top of
`new-worktree-dialog`) and rebuilt on this base. Two hunks use one line of context so it
applies in any order with the other patches: `layouts/main.json` (`board-toggle` adds
`toast` next to `titlebar`) and `new-menu`'s New space row (`open-all-worktrees` changes the
rows two lines below it; its own `new-menu` hunks also use one line of context for this).

## What it does

- `my-new-menu` (+ in the tab bar): New space passes `{ folder, machine }`.
- `my-menu` (the menu with New space, Keybinds, Theme): the same. `my-main` sets `"terminal_menu": "my-menu"` so the menus Herdr opens itself are the copy too.
- `my-spaces`: the + at the top of the sidebar, and each machine group's + when the shown
  space is on that machine.

## What it expects from Herdr's original

- `layouts/main.json`: the root's `"background": "canvas",` line followed by
  `"terminal_padding": [` (`terminal_menu` goes between them).
- `mods/new-menu/main.js`: `const KNOWN = "new-menu.agents";` (`here()` goes after it) and
  the row `"New space", () => run("space.new"), shortcut("space.new")`. `spaces` and `panes`
  are imported.
- `mods/menu/main.js`: `place(s)` ending `|| s.folder;` then `}` (`here()` goes after it) and
  the item `["New space", "space.new", {}]`.
- `mods/spaces/main.js`: `place(s, ps)` ending `|| s.folder;` then `}` (`here()` goes after
  it), the sidebar's `.on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg")…`
  and the machine rows' two `run("space.new", { machine: m ?? "" })`.

## How to check it works

- `cd` somewhere in a terminal, click a mod pane (Files), then + → New space: the new
  space's terminal starts in that folder.
- The same with the + at the top of the sidebar.
