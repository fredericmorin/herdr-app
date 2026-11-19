# Patcher

Keeps personal changes to Herdr's own mods and layouts as patches on copies, so the
copies follow Herdr's updates and a release that breaks a change is caught, not lost.

Herdr replaces its shipped mods and layouts at every start (an edited one is moved aside
to `<name>-edited`), so they can't be changed in place. Instead, `main.js` has two lists:

- `COPIES`: Herdr's originals that get a personal copy (`mods/worktree` → `mods/my-worktree`,
  `layouts/main.json` → `layouts/my-main.json`, …), or that are patched in place when
  nothing reads a copy (`AGENTS.md` → `AGENTS.md`);
- `PATCHES`: `patches/<name>.patch`, applied in that order.

The patcher copies every original to a temporary folder at its own path
(`mods/worktree/…`, `layouts/main.json`), applies each patch there with `git apply`
(exact context, no fuzz), checks each copy that differs from the installed one
(`herdr-app check` for a mod, valid JSON for a layout) and installs those.

An in-place file is Herdr's version until the patcher installs over it. The patcher keeps
Herdr's version in `.in-place/<file>.base` and what it installed in `.in-place/<file>.out`:
while the file still matches `.out`, it patches `.base` again; anything else is a new
version from Herdr and becomes the `.base`.

It runs at every start (its floating block in `layouts/my-main.json`) and when opened:
`herdr-app do mod.open --name patcher` shows each patch and copy and can apply again.

After cloning this folder, nothing starts the patcher: the copies (`layouts/my-main.json`
included) are generated and not in git, so Herdr shows its own `main` layout. Run
`herdr-app do mod.open --name patcher` once and, when every patch shows ✓, click
**Use the my-main layout**. From then on it runs at every start.

All copies change together or not at all. When a patch fails, the last working copies
stay, `~/.config/herdr-app/patcher.error` says which patch, file and line, and a toast
appears (click it to open the patcher window).

The copies (`mods/my-*`, `layouts/my-main.json`, `AGENTS.md`) are generated: never edit
them, edit the patches. Each generated mod folder has a `GENERATED.md` listing the patches that
changed it.

At start it also runs `projects.js`: it keeps `~/.config/herdr-app/projects.json` (the
per-project settings patches read) present, with a commented reference of every setting at
its top, replaced whenever it differs from `REFERENCE` in `projects.js`.

## One patch per change, named after it

A patch is one coherent change, across as many copies as it needs: `open-all-worktrees`
changes the worktree dialog, two menus and the tab bar together. Its name is a short slug
of what it changes (`project-worktree-settings`), never of the file it touches. Don't
split one change into per-file patches, and don't mix unrelated changes in one patch.

`use-patched-copies` is the base: it makes `my-main` show the copies and the copies open
each other. It goes first in `PATCHES`. Every other patch is made on top of the base
alone, never on top of another feature patch, and touches lines no other feature patch
touches, so feature patches apply in any order, and one that breaks fails and gets fixed
alone. When two changes need the same lines, find another place for one of them (as
`sync-new-worktrees` does with its own import and its claim in `work()`), or they're one
change.

## Every patch needs a doc

Each `patches/<name>.patch` has a `patches/<name>.md` with:

- **Made on top of**: `use-patched-copies` for a feature patch, and why if it shares lines
  with it.
- **What it does**: the change as the person sees it, copy by copy, and which mods depend
  on it.
- **What it expects from Herdr's original**: for each file it touches, the exact
  functions, calls, strings and structure the patch hooks into, and the assumptions it
  relies on. This is what you need when a new Herdr release moves that code: it says what
  to find again and what to rebuild there, even when the diff no longer makes sense.
- **How to check it works**: steps that prove the copies behave as intended.

Keep the docs current. A patch isn't done without its doc:

- adding a patch: write its `.md` in the same change;
- changing a patch: update its `.md` in the same change, above all "What it expects"
  when it now hooks into different code;
- removing a patch: remove its `.md` and its name from `PATCHES`.

## Adding a patch

1. If it changes an original that has no copy yet, add it to `COPIES`, and point whatever
   shows that original at the copy in `use-patched-copies` (a menu that opens it, a block
   in the layout).
2. Write the patch on top of `use-patched-copies` (below) and its `.md`.
3. Add its name to `PATCHES`.
4. Open the patcher: the patch shows ✓ applied and its copies updated. Try it in the app.

## Writing or fixing a patch

A patch is `diff -ru a b`, run in a folder where `a/` and `b/` each mirror the originals
at their paths under `~/.config/herdr-app` (`a/mods/worktree/main.js`,
`a/layouts/main.json`): `a/` is what the patch applies to, `b/` your version. Run
`git apply` outside any git repo (a temporary folder): inside one, it skips files it takes
as outside the repo.

When Herdr updates and a patch fails:

1. Read `~/.config/herdr-app/patcher.error` (which file and line) and the patch's `.md`
   (what it does and what it expects).
2. Rebuild it on Herdr's new originals, for example `open-all-worktrees`:

   ```sh
   H=~/.config/herdr-app; P=$H/mods/patcher/patches
   cd "$(mktemp -d)" && mkdir -p a/mods a/layouts
   cp -R $H/mods/worktree $H/mods/menu $H/mods/new-menu $H/mods/spaces $H/mods/tabs a/mods/
   cp $H/layouts/main.json a/layouts/
   cp $H/mods/patcher/.in-place/AGENTS.md.base a/AGENTS.md   # only for a patch on AGENTS.md
   (cd a && git apply $P/use-patched-copies.patch)   # leave out when fixing the base itself
   cp -R a b
   (cd b && git apply --reject $P/open-all-worktrees.patch)
   # Hunks that still fit are applied; the rest are in b/**/*.rej. Redo those by hand in
   # b/, following the .md, then delete the .rej files.
   diff -ru a b > $P/open-all-worktrees.patch
   ```

3. After fixing `use-patched-copies`, check the feature patches still apply: the patcher
   window shows it. Rebuild any that fail the same way, on the new base.
4. Update the `.md` if the patch now hooks into different code.
5. Saving the patch reapplies it at once; the patcher window shows the result.
