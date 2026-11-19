# use-patched-copies

The base patch: `my-main` shows the patched copies, the copies open each other, and the
layout runs the patcher. Every other patch is made on top of this one.

## What it does

- `layouts/main.json` → `my-main.json`: the sidebar's `spaces` block shows `my-spaces`, the
  top bar's `tabs` block shows `my-tabs`, and a floating `patcher` block on the root runs
  the patcher at every start (it draws nothing; a mod only runs while it has a place in the
  layout).
- `mods/spaces` → `my-spaces`: right-clicking a space opens `my-menu`.
- `mods/tabs` → `my-tabs`: the + button opens `my-new-menu`.
- `mods/menu` → `my-menu` and `mods/new-menu` → `my-new-menu`: the worktree items open
  `my-worktree`.

Nothing changes for the person by itself: the copies behave like Herdr's until other
patches change them.

## What it expects from Herdr's original

- `layouts/main.json`:
  - The root object has `"divider": { … },` right before `"children": [`; the floating
    list goes between them.
  - Blocks with `"content": { "mod": "spaces" }` and `"content": { "mod": "tabs" }`, in
    Herdr's formatting (2-space indent, one key per line).
  - If Herdr moves, renames or adds blocks: every `spaces` block shows `my-spaces`, every
    `tabs` block shows `my-tabs`, the `patcher` floating block sits on the root.
- `mods/spaces/main.js`: the method `menu(w)` opens the space menu with
  `openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } })`.
  That's the only place it names `menu`. If Herdr opens the space menu elsewhere, change
  that call.
- `mods/tabs/main.js`: `button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))`.
  Its window icons load from `mods/tabs/` (Herdr's folder, which stays), so the copy needs
  no asset changes.
- `mods/menu/main.js`: `choose()` opens the worktree dialog with
  `if (it[1] === "worktree") openOverlay({ mod: "worktree", … props: it[2] })`.
- `mods/new-menu/main.js`: the rows `this.row("worktree", …)` (New worktree…) and
  `this.row("worktree-open", …)` (Open worktree…) each call `openOverlay({ mod: "worktree", … })`.

Not in the patch: clicks on `my-main` (theme, sizes) live in `layouts/.state/my-main.json`
and survive each rebuild. `my-main` was first made with `layout.clone` so `main`'s clicks
(the theme) carried over.

## How to check it works

- The patcher window lists every copy, no `layouts/my-main.error`.
- `herdr-app status` shows `"layout": "my-main"` and a float `patcher` with 0×0 bounds.
- Right-click a space and click + in the tab bar: the menus open (the patched copies).
