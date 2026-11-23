// Each space's git facts and its repos' worktree lists, published as shared
// `status.git` and `status.worktrees`. Ported from my-spaces' git refresher, so the
// keys are exactly its where() keys.

import { spaces, machines, panes, exec, setShared, watchFolder, window } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// `git worktree list --porcelain`: each checkout's path and branch, prunable ones left out.
// Copied from worktree-sync's parse().
function parse(text) {
  const list = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    // While git worktree add runs, the checkout is "locked initializing", at first with no branch
    // (so no claim matches): leave it out, to be judged once git is done.
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable") || l === "locked initializing")) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    list.push({ path, branch });
  }
  return list;
}

export class GitStatus {
  constructor() {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked, top, added, removed }, null: not a repo
    this.worktrees = {}; // repo -> [{ path, branch }]
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    this.published = { git: "", worktrees: "" };
  }

  // Each space's place and branch, for the review lookups.
  places() {
    const ps = panes();
    return spaces().map((s) => {
      const key = where(s, ps);
      return { key, machine: s.machine, folder: place(s, ps), branch: this.git[key]?.branch, repo: Boolean(this.git[key]) };
    });
  }

  tick(cx) {
    const due = this.due(Date.now(), spaces(), panes());
    if (due.size) this.refreshGit(due, cx);
  }

  close() {
    for (const pending of this.watching.values()) pending.cancel();
    this.watching.clear();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    let gone = false;
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
      gone = true;
    }
    if (gone) this.publish();
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
        // Each repo seen in this batch: its worktree list, asked from one of its places.
        const repos = new Map();
        for (const k of keys) if (this.git[k]) repos.set(this.git[k].repo, k);
        for (const [repo, k] of repos) await this.listWorktrees(repo, k);
        this.publish();
      }
      this.refreshing = false;
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git`, top };
      // Uncommitted lines against HEAD, staged and unstaged (none before the first commit).
      // No optional locks or fsmonitor: writing the index would wake the repo watch and loop.
      const diff = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "diff", "--numstat", "HEAD"], { cwd, on });
      info.added = 0;
      info.removed = 0;
      if (diff.code === 0) {
        for (const line of diff.stdout.split("\n")) {
          const [added, removed] = line.split("\t");
          info.added += parseInt(added, 10) || 0;
          info.removed += parseInt(removed, 10) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  async listWorktrees(repo, key) {
    const [on, cwd] = JSON.parse(key);
    try {
      const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd, on });
      if (r.code === 0) this.worktrees[repo] = parse(r.stdout);
    } catch {} // the machine is away: keep the last list
  }

  // Writes each key only when it changed; repos no space is in any more are dropped.
  publish() {
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const repo of Object.keys(this.worktrees)) if (!repos.has(repo)) delete this.worktrees[repo];
    const git = JSON.stringify(this.git);
    if (git !== this.published.git) {
      this.published.git = git;
      setShared("status.git", JSON.parse(git));
    }
    const worktrees = JSON.stringify(this.worktrees);
    if (worktrees !== this.published.worktrees) {
      this.published.worktrees = worktrees;
      setShared("status.worktrees", JSON.parse(worktrees));
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }
}
