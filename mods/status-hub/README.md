# Status hub

The one place that fetches each space's git facts, its repos' worktree lists and its
pull/merge request status. It publishes them as shared state; other mods only read.

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
           ci: "pass" | "fail" | "pending" | "none", failed: [{ name, url }],
           updatedAt, look: { icon, tone, label, ready } }
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
  `draft`, `merged`, `closed`); `tone` is a theme color name (draw `theme()[look.tone]`);
  `label` says the state ("Ready to merge", "Checks failed", …); `ready`: mergeable now.
- Updates once a minute per place, and at once when its branch changes.
- GitHub: every github.com remote, `gh pr list --head <branch>`, heads in the checkout's
  own remotes only; `git config branch.<b>.herdr-pr owner/repo#42` binds one PR instead.
- GitLab: remotes on gitlab.com or a host containing `gitlab`; `glab mr list
  --source-branch`, then `glab mr view` for open ones (pipeline, conflicts, merge status);
  sources in the checkout's own remotes only (by project id).
  **The glab flags and JSON fields come from glab's docs and haven't been tried against
  a live GitLab** (glab wasn't installed when this was written); only the
  `"glab not installed"` path is verified.
- Git runs on the space's machine; gh and glab run on this computer.
- Readers: my-spaces' PR badge (step 3), the status bar (step 5).

## Coming

Step 4 of the status-hub plan adds `status.board`, `status.focused`, `status.requests` and
`status.replies` (the Board's data and its request queue).
