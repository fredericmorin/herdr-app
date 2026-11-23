# agents-md-patcher

Tells agents reading `AGENTS.md` that this setup has a patcher and where its README is, and
that shared status comes from `mods/status-hub`.

Made on top of: `use-patched-copies` (shares no lines with it: it touches only `AGENTS.md`).

## What it does

- `AGENTS.md` (patched in place, `to` = `from` in `COPIES`): a **Patcher (this setup)**
  paragraph in the Layouts section, right after the paragraph on clones. It says the patcher
  keeps changes to Herdr's behavior that settings or a separate mod can't make, that it
  rebuilds `mods/my-*`, `layouts/my-main.json` and `AGENTS.md` at every start, that those
  are never edited by hand, and that `mods/patcher/README.md` says more.
- Right after it, a **Shared status (this setup)** paragraph: `mods/status-hub` fetches each
  space's git facts, worktrees and PR/MR status and publishes them as shared `status.*` keys
  (contract in `mods/status-hub/README.md`), so a new mod reads those instead of running git
  or gh.

No mod depends on it.

## What it expects from Herdr's original

- `AGENTS.md`: in "Layouts", the paragraph on clones ends with
  `Mod clones rewrite their own \`mods/<name>/\` asset paths and self-opening` /
  `overlay names to the new name.`, followed by a blank line and the paragraph starting
  `If you edit a shipped file anyway, the next start moves it to`. The new paragraphs go
  between them.
- If Herdr moves or rewrites that text: put the paragraphs wherever AGENTS.md explains that
  Herdr's own layouts and mods are read-only and how to clone them.

## How to check it works

- Open the patcher (`herdr-app do mod.open --name patcher`): `agents-md-patcher` ✓ applied,
  `AGENTS.md` updated or up to date.
- `grep -n "Patcher (this setup)\|Shared status (this setup)" ~/.config/herdr-app/AGENTS.md` finds both paragraphs.
- Apply again from the patcher window: still ✓ (it patches Herdr's kept version in
  `mods/patcher/.in-place/AGENTS.md.base`, not the already patched file).
- After restarting Herdr, the paragraph is back.
