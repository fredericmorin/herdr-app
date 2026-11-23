# settings-projects

A **Projects** section in Herdr's Settings (Cmd+,) that edits `~/.config/herdr-app/projects.json`:
the defaults and every project, with live pickers for the Board.

Made on top of: nothing. It patches only `frame/settings/main.js` in place (`to` = `from` in
`COPIES`), which `use-patched-copies` doesn't touch.

## What it does

- `frame/settings/main.js` (patched in place) gets five hooks. Everything else is in
  `frame/settings/projects.js`, our own file: its source is `mods/patcher/files/frame/settings/projects.js`
  (in `FILES`, installed beside the patched screen, with `folder.svg` for the nav icon).
- The section, top to bottom:
  - the projects, with *Defaults* first. The focused space's repo is selected on open and marked "this space".
  - *Add project*: the local spaces' repos that aren't listed yet, or *Choose folder…*. A folder is
    resolved to its repo's main checkout and written as `~/…`.
  - *Remove project*, with an inline confirmation.
  - Worktrees: *Folder* and *Setup script* (per project), and *Delete branch on remove*.
  - Claude sessions: worktree and Plan mode for *Board Start* and for *New session*.
  - Board (per project): *None*, *Vikunja* or *Linear*.
    - Vikunja: a project list from Vikunja's MCP `projects_list` (curl with the headers of the server
      added to Claude Code, the same call as `mods/status-hub/board/vikunja.js`, from the board's
      `claudeConfig` dir if it has one), or an id field if that fails. Picking a project keeps `claudeConfig`.
    - Linear: scope (My issues, Team cycle, Project, View), a team list (`list_teams`), and a project or
      view list (`list_projects` / `list_custom_views`, by team) plus a URL field, then an optional title.
      Calls go through `node mods/status-hub/board/linear-mcp.mjs call`, signed in from the Board.
      A choice that isn't complete yet (a cycle with no team, a project with no URL) stays a draft
      on screen and isn't written.
- Yes/no settings are `Default (on|off)` / `On` / `Off`. *Default* removes the key. Its label shows what
  is inherited: the top-level value for a project, else the reader's built-in.
- Every change is written at once, in order, with a compare-and-swap write that re-reads and retries
  (like Settings' own `save()`). Text fields are written as they're typed. The reference block at the
  top is kept byte for byte; the rest is `JSON.stringify(…, null, 2)`, so hand comments below the
  reference are dropped. Empty groups are pruned; an added project with nothing set stays `{}`.
- A file that doesn't parse shows the error and a *Read again* button, and nothing is written. A value
  the section doesn't understand (a string for a yes/no, a board with two trackers) is named in the
  row, and choosing a control replaces it.
- Clicking *Projects* in the nav reads the file again, so hand edits show.
- `herdr-app do app.settings --section projects` opens it.

When a patch or mod adds a setting to `projects.json`, add it here too (`FLAGS`, or a row in
`render()`), and to `REFERENCE` in `mods/patcher/projects.js`.

## What it expects from Herdr's original

`frame/settings/main.js`. If Herdr renames or rewrites these, put the same hooks where the
equivalent code now lives.

- The `import { … } from "herdr";` line (line 5): the `ProjectsSection` import goes right after it.
- `SECTIONS`: an array of `{ id, title, icon }`, with `icon` naming `frame/settings/<icon>.svg`
  (through `I()`). The Projects entry goes after `machines`.
- `init()`: the run of `this.machine… = null;` assignments ending `this.machineNotice = null;`, then
  `this.handle = cx.focus_handle();`. `new ProjectsSection(this, cx)` goes between them.
- The nav's `on_click` in `render()`: the line
  `if (s.id === "machines") cx.spawn(async (cx) => { await this.loadMachines(); cx.notify(); });`,
  after which the Projects reload goes.
- The body's chained ternary on `this.section` (`"look"`, `"keyboard"`, `"machines"`, …): the
  `"projects"` branch goes after `"machines"`.
- What `projects.js` uses of the Settings view (`host`):
  - `heading(t, text)`, `row(t, title, about, control)` and `button(t, id, label, onClick)`, as elements;
  - `person`, settings.json parsed (for `worktrees.directory`, the Folder row's default).
- `herdr-app check` of `frame/settings` with both files must pass: the patcher checks the whole
  screen folder, copied from Herdr's with the patched `main.js` and our files over it.
- Outside Settings: `mods/status-hub/board/linear-mcp.mjs` (`call <tool> <json>`, printing one JSON line
  `{ok, value}` or `{ok: false, status, error}`), Vikunja's MCP at `https://todo.endor.one/api/v2/mcp`,
  and the shapes of `projects.json` that `mods/my-worktree`, `mods/claude-new` and `mods/issue-board`
  read.

## How to check it works

- Open the patcher (`herdr-app do mod.open --name patcher`): `settings-projects` ✓ applied, and
  `frame/settings/main.js`, `frame/settings/projects.js` and `frame/settings/folder.svg` are up to date
  or updated.
- `herdr-app do app.settings --section projects`: the section opens on the focused space's repo.
- Toggle a yes/no setting, then set it back to Default. In `projects.json`, the key comes and goes and
  the reference block is unchanged.
- Board → Vikunja shows your projects as "Parent › Child". Picking one writes `"board": { "vikunja": <id> }`,
  and the Board shows it.
- Board → Linear → Team cycle → a team writes `{ "team": …, "cycle": true }`. Project with no URL writes
  nothing until one is picked or pasted.
- Add a stray comma to `projects.json`: the section shows the error and writes nothing.
- Restart Herdr: Settings still has Projects (the patcher re-applies on Herdr's fresh `frame/settings`).
