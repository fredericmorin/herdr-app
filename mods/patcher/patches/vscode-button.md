# vscode-button

The tab bar gets an **Open in VS Code** button (VS Code's full-color logo) right after the **+**,
opening the focused space's worktree in VS Code.

Made on top of: `use-patched-copies` (only for consistency: it touches no line of the base).
The patch has one line of context (`diff -U1`).

## What it does

- `my-tabs`, `render()`: the `button(id, label, action)` helper is renamed `plainButton`, and a
  new `button` wraps it: for `id === "tab-new"` (the +) it returns an `h_flex` holding the +
  and an `open-vscode` button that runs `mod.open {name: "vscode"}`; every other id gets
  `plainButton` unchanged. Done in the helper, not at the `+` call, because
  `open-all-worktrees` changes the `+` line.
- Depends on `mods/vscode` (its `main.js` opens the folder and closes itself; its `icon.png`, VS Code's `Code.icns` converted with `sips -s format png -Z 64`).

## What it expects from Herdr's original

- `mods/tabs/main.js`, `render()`:
  - `const stop = (_e, cx) => cx.stop_propagation();` followed by the two-line
    `const button = (id, label, action) => div().id(id).size(26)…child(label);` helper,
    followed by `const item = (c, i) => {`.
  - The + is drawn with `button("tab-new", "+", …)`.
  - `h_flex` (gpui-base), `image` (gpui-kit) and `run` (herdr) imported.

## How to check it works

1. The tab bar shows `+` then the VS Code logo, then Files / Changes.
2. Click the logo in a space on this computer: VS Code opens that worktree's git root.
3. Click it in a space on another machine: VS Code opens it over Remote-SSH.
4. `+` still opens the new menu.
