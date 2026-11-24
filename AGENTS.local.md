# This setup

**Patcher:** changes to Herdr's own behavior that settings or a separate mod can't
reach are kept as patches by the `patcher` mod, in `mods/patcher/patches/`. At every
start it rebuilds patched copies of Herdr's originals (`mods/my-*`,
`layouts/my-main.json`, `frame/settings/main.js`) so they follow Herdr's updates.
Never edit those copies; edit the patches. How it works and how to add or fix a
patch: `mods/patcher/README.md`.

**Shared status:** `mods/status-hub` fetches each space's git facts, worktrees and
PR/MR status once and publishes them as shared `status.*` keys (contract:
`mods/status-hub/README.md`); a new mod reads those instead of running git or gh
itself.
