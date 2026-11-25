# Status hub

The one place that fetches each space's git facts, its repos' worktree lists, its
pull/merge request status and the focused space's issue board (Vikunja or Linear). It
publishes them as shared state; other mods only read. The Board (`mods/issue-board`) asks
for tracker actions through a request queue: every Vikunja and Linear call is made here.

**A new mod reads these keys (`shared("status.git")`, …) instead of running git, gh or glab
itself.** Reading is free: a mod re-renders whenever shared state changes.

It draws nothing and runs as a 0×0 float on the `tabs` block of `my-main` (patch
`run-status-hub`). Under `herdr-app check` it does nothing. It writes a key only when its
value changed.

## Keys

### `status.git`

```
{ [where]: { name, branch, ahead, behind, repo, linked, top, added, removed } | null }
```

- `where` = `JSON.stringify([machine | null, place])`, where `place` is the space's first
  terminal's live folder, else the folder it was made in. Same code as my-spaces'
  `place()` / `where()`: keep them identical.
- `name`: the repo's folder name. `branch`: the branch, or `"(detached)"`.
  `ahead` / `behind`: against its upstream (0 without one).
- `repo` = `JSON.stringify([machine | null, gitCommonDir])`: one id for a repo and all its
  worktrees. `linked`: this checkout is a linked worktree. `top`: the checkout's
  `--show-toplevel`.
- `added` / `removed`: uncommitted lines against HEAD, staged and unstaged.
- `null`: not a git repo (or a machine that couldn't answer yet). A missing key: not looked
  at yet. Spaces that close, or move elsewhere, drop their key.
- Updates when a space appears or moves, when a command or an agent's turn ends in it
  (every place in that repo), when its machine comes back, when a local repo's `.git`
  changes (watched), and every 60 s while the window is in front.
- Readers: my-spaces (step 3), worktree-sync (step 2), the hub's board logic and the
  status bar (steps 4, 5).

### `status.worktrees`

```
{ [repo]: [{ path, branch }] }
```

- `repo`: as in `status.git`. `git worktree list --porcelain`, parsed as worktree-sync's
  `parse()` does: bare, prunable and "locked initializing" checkouts are left out; `branch`
  is null when detached.
- Updates after each `status.git` look at a place in that repo. Repos no space is in any
  more are dropped.
- Readers: worktree-sync (step 2).

### `status.reviews`

```
{ [where]: { branch, items: [Review], error? } }
Review = { host: "github" | "gitlab", repository, number, title, url,
           state: "open" | "draft" | "merged" | "closed",
           ci: "pass" | "fail" | "running" | "queued" | "manual" | "none", failed: [{ name, url }],
           autoMerge, updatedAt, look: { icon, tone, label, ready } }
```

- `where`: as in `status.git`; only places that are git repos. `branch`: the branch the
  items describe: show them only while it equals `status.git[where].branch`.
- `items`: open (and draft) ones first, most recently updated first; with none open, the
  most recent closed or merged one. Empty: no PR/MR for this branch.
- `error`: the last lookup failed (gh not logged in, offline, `"glab not installed"`).
  Items from before the error are kept while the branch is the same.
- `repository`: `owner/repo` on GitHub, the project path (nested groups) on GitLab.
  `number`: the PR number, or the MR's iid: show GitLab ones as `!N`, GitHub ones as `#N`.
- `look`: what a badge shows. `icon` is a file in `mods/status-hub/icons/` (`pull-request`,
  `auto-merge`, `draft`, `merged`, `closed`); `tone` is a theme color name (draw `theme()[look.tone]`);
  `label` says the state ("Ready to merge", "Needs approval", "Checks failed", …); `ready`:
  mergeable now. "Needs approval": GitHub's `reviewDecision` `REVIEW_REQUIRED`, GitLab's
  `detailed_merge_status` `not_approved` (blue, `ansi4`). On GitLab only `mergeable` is green:
  `unchecked` / `checking` (GitLab hasn't re-checked yet) are dim "Checking", `ci_still_running` /
  `ci_must_pass` with a running pipeline and an approved MR (the `approvals` endpoint, asked only
  then) is green "Approved, checks running" (or "queued"), and any other
  blocking status is yellow (`ansi3`) with its reason ("Needs rebase", "Discussions open", …,
  else "Blocked"). On GitHub `mergeStateStatus` `UNKNOWN` is dim "Checking", `BEHIND` yellow
  "Branch behind", `BLOCKED` yellow "Blocked" (but green "Approved, checks running" when
  approved, or no review required, and `ci` is `running` or `queued`); green "Open" is left for `UNSTABLE` and
  `HAS_HOOKS`, which can still merge. `look` is the review state; `ci`
  is drawn beside it (my-spaces' dot).
- `ci`: `running` while a check runs (GitHub `IN_PROGRESS` or a `PENDING` status, GitLab
  `running`), else `queued` while one waits to start (GitHub `QUEUED`/`PENDING`/`REQUESTED`
  or `EXPECTED`, GitLab `pending`, `created`, `waiting_for_resource`, `preparing`,
  `scheduled`), else `manual` while one waits on someone (GitHub `WAITING`, GitLab `manual`).
  `fail` wins over all of them.
- `autoMerge`: an open one is set to merge by itself once it can (GitHub's `autoMergeRequest`,
  GitLab's `merge_when_pipeline_succeeds`). Its `look.icon` is then `auto-merge` (a clock)
  instead of `pull-request`; `tone` and `label` stay the review state's.
- Updates once a minute per place, at once when its branch changes, and when a command or an
  agent's turn ends there (`GitStatus.takeEnded()`; not cached, at most every 10 s per place).
- GitHub: every github.com remote, `gh pr list --head <branch>`, heads in the checkout's
  own remotes only; `git config branch.<b>.herdr-pr owner/repo#42` binds one PR instead.
  gh runs as `projects.json`'s `github.account` for the repo (its main checkout's entry, else
  the top level's; `board/config.js` `githubAccount()`), through
  `sh -c 'GH_TOKEN=$(gh auth token --user …) exec gh …'`, so the token is never on a command
  line. No account set: gh's active account. A set account gh has no login for is an error
  (`no oauth token found for github.com account …`); no other account is tried. Spaces on
  another machine use the top-level account only.
- GitLab: remotes on gitlab.com or a host containing `gitlab`; `glab mr list
  --source-branch`, then `glab mr view` for open ones (pipeline, conflicts, merge status);
  sources in the checkout's own remotes only (by project id). Tried against gitlab.com
  with glab 1.131.
- Git runs on the space's machine; gh and glab run on this computer.
- Readers: my-spaces' PR badge (step 3), the status bar (step 5), the Board's cards
  (`mods/issue-board`: a card's session's space, and its Fix CI button).

### `status.board`

```
{ key, repo, title, openUrl, tracker, trackers, columns, syncedAt, loading,
  error, boardError, setup, readOnly, signingIn }
tracker  = { name, title, noun, labelKey, setup: { title, steps: [{ text, copy? }], signIn? },
             settings: { models, efforts } | null } | null
trackers = [{ name, title, labelKey, hint, example }]   every tracker, for "no board" hints
column   = { id, title, limit, done, add, todo, capped, cards, type?, hidden? }  (hidden: Linear's "hidden" list)
card     = { id, ref, title, description, done, doneAt, due, urgency,
             labels: [{ id?, title, color }], who, url, label, model?, effort?, … }
```

- The focused space's board: its repo's `board` in `projects.json` (keyed by the main
  checkout, so a worktree space shows its repo's), parsed by `board/tracker-vikunja.js` or
  `board/tracker-linear.js`. The repo comes from `status.git` (`board/target.js`).
- `key`: the board's id, null without a board. `repo`: the main checkout, null outside git
  or on another machine; **left out** while the hub hasn't looked at the space yet.
- `openUrl`: the tracker page. `syncedAt`: the last good load (ms). `loading`: a load runs.
- `error`: the last load or action error. `boardError`: why `projects.json`'s entry isn't
  usable. `setup`: the tracker needs a token or a sign-in (show `tracker.setup`: each step's
  `text`, then its `copy` line with a Copy button).
  `readOnly`: a write was refused. `signingIn`: a Linear browser sign-in is waiting.
- Cards keep their tracker fields (Linear adds `team`, `teamKey`, `state`, `type`,
  `assigned`, `branch`); requests send them back as they are. `label` is the terminal label
  Start puts on a session (`vikunja.task=<id>`, `linear.issue=<ID>`). `model` / `effort`:
  a Vikunja card's `model/` and `effort/` labels ("" for Default); Linear cards have none.
- Descriptions are included (Markdown): this repo's board was 26 KB; leave them out
  if it grows past ~200 KB (Start and Edit read the item fresh anyway).
- Updates every 60 s, when another space is focused or its repo is found, when a card's
  session stops working or ends, and after the hub's own writes. The Vikunja instance is
  the layout's `board` block's `props.url` (default `https://todo.endor.one`). Its token is
  the one Claude Code has: the headers of the user-scope MCP server with URL `<url>/api/v2/mcp`
  in `<dir>/.claude.json`, read by `board/claude-mcp-headers.mjs` for each call. `<dir>` is
  the board's `claudeConfig` in `projects.json` (`"board": { "vikunja": 16, "claudeConfig":
  "~/.claude-personal" }`), else `$CLAUDE_CONFIG_DIR`, else `~`: the app is usually started
  without `$CLAUDE_CONFIG_DIR`, so a server added under another profile needs `claudeConfig`.

### `status.focused`

```
{ where, ticket: { tracker, ref, title, column, url } | null }
```

- `where`: the focused space's key, as in `status.git`. `ticket`: the card on the shown
  board whose `label` is on the focused terminal, else on an agent in the focused tab,
  else in the space. `column` is its column's title.
- Readers: the status bar (step 5).

### `status.requests` / `status.replies`

```
status.requests = [{ id, op, args }]
status.replies  = { [id]: { ok, value?, error?, id?, at } }
```

- Append to `status.requests` in one synchronous read-modify-write
  (`mods/issue-board/requests.js`); the hub takes the queue and sets it to `[]`.
  `id`: `${Date.now()}-${n}`. `key`: the board's key; the hub remembers every board it
  resolved this session, so a dialog that outlives a focus change saves to its own.
- Board ops, fire and forget (failures land in `status.board`'s `error` / `readOnly` /
  `setup`):
  - `board.refresh {}`
  - `board.move {key, item, column}`: item = a card, column = a column without `cards`.
  - `board.start {key, item, column}`: reads the item, then opens `claude-new` with the
    ticket message and `started: "issue-board.started"`. Confirming there writes that key;
    the hub's tracker then moves the card (Vikunja: Plan or Doing; Linear: In Progress,
    assigned to you if nobody has it). Starts from before the hub began never replay.
  - `board.signIn {key}`: Linear's browser sign-in, then a refresh.
- Dialog ops, answered in `status.replies[id]` (kept 60 s, then dropped by the next reply or
  the hub's minute timer; ignore unknown ids):
  - `task.read {key, id}` → `value: { title, description, labels, model, effort }`.
  - `task.save {key, edit: { column: {id, title} }, form: { id, labels, title,
    description, model, effort }}` → `{ ok: true }`, or `{ ok: false, error, id }`: `id`
    is an item made before a later error, so a retry edits it instead of making another.
    After a save the hub refreshes the board.
- Readers: issue-board (the Board and its edit dialog).
