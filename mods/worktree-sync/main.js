// Worktree sync: a space, in the background, for each checkout (git worktree) that
// appears in a repo with a space open, whoever made it (git, an agent, another app).
// It remembers the checkouts it has seen, so a repo's checkouts at first sight are
// left to "Open all worktrees", and a space you close stays closed. Branches that
// my-worktree claims are left alone: it opens their space itself. Draws nothing.

import { View, div } from "gpui-kit";
import { spaces, panes, exec, run, shared, checking, watchFolder } from "herdr";

// Remote repos can't be watched, and a watch can be reclaimed: look again this often anyway.
const FALLBACK = 60_000;
// How long a claim from my-worktree holds (git worktree add can take a while).
const CLAIM = 600_000;

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

const inside = (path, dir) => path === dir || path.startsWith(dir + "/");

// A space shows a checkout when its first terminal is in it and not in a checkout nested inside it.
function hasSpace(c, list, on, sp, ps) {
  for (const s of sp) {
    if ((s.machine ?? null) !== on) continue;
    const at = place(s, ps)?.replace(/\\/g, "/");
    if (!at || !inside(at, c.path)) continue;
    const nested = list.some((o) => o.path !== c.path && o.path.length > c.path.length && inside(at, o.path));
    if (!nested) return true;
  }
  return false;
}

// `git worktree list --porcelain`: each checkout's path and branch, prunable ones left out.
function parse(text) {
  const list = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    list.push({ path, branch });
  }
  return list;
}

export default class WorktreeSync extends View {
  init(_props, cx) {
    if (checking()) return;
    // repo -> the checkout paths seen last time; JSON [machine, git common dir] keys.
    try { this.seen = JSON.parse(localStorage.getItem("seen") ?? "{}"); } catch { this.seen = {}; }
    this.repoAt = {}; // JSON [machine, folder] -> its git common dir, null outside git
    this.watching = new Set();
    this.places = "";
    cx.timer.every(FALLBACK, (cx) => this.look(cx));
    // New spaces and shells that moved change which repos are in view: cheap to notice, no git.
    cx.timer.every(2000, (cx) => {
      const ps = panes();
      const now = JSON.stringify(spaces().map((s) => [s.machine ?? null, place(s, ps)]));
      if (now === this.places) return;
      this.places = now;
      this.look(cx);
    });
  }

  look(cx) {
    if (this.looking) {
      this.again = true;
      return;
    }
    this.looking = true;
    cx.spawn(async (cx) => {
      try { await this.sync(cx); } catch (error) { console.log(`worktree-sync: ${error}`); }
      this.looking = false;
      if (this.again) {
        this.again = false;
        this.look(cx);
      }
    });
  }

  async sync(cx) {
    // The repos in view, each with one folder inside it to run git in.
    const repos = new Map();
    const ps = panes();
    for (const s of spaces()) {
      const at = place(s, ps);
      if (!at) continue;
      const on = s.machine ?? null;
      const where = JSON.stringify([on, at]);
      if (!(where in this.repoAt)) {
        try {
          const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: at, on });
          this.repoAt[where] = r.code === 0 ? r.stdout.trim() : null;
        } catch { continue; } // its machine is away: ask next time
      }
      const dir = this.repoAt[where];
      if (dir) repos.set(JSON.stringify([on, dir]), { on, dir, at });
    }
    this.inView = new Set([...repos.values()].filter((r) => r.on === null).map((r) => r.dir));
    for (const [key, { on, dir, at }] of repos) {
      let r;
      try { r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: at, on }); } catch { continue; }
      if (r.code !== 0) continue;
      const list = parse(r.stdout);
      const known = this.seen[key];
      if (known) {
        const now = Date.now();
        const claims = shared("worktree-sync.claims") ?? {};
        const sp = spaces(), ps2 = panes();
        for (const c of list) {
          if (known.includes(c.path)) continue;
          const claimed = c.branch !== null && now - (claims[c.branch] ?? 0) < CLAIM;
          if (!claimed && !hasSpace(c, list, on, sp, ps2)) run("space.new", { folder: c.path, machine: on ?? "", focus: false });
        }
      }
      this.seen[key] = list.map((c) => c.path);
      if (on === null) this.watch(dir, cx);
    }
    try { localStorage.setItem("seen", JSON.stringify(this.seen)); } catch {}
  }

  // A local repo's git folder changes when a checkout is added there: look again then.
  watch(dir, cx) {
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.inView.has(dir)) {
          await watchFolder(dir);
          this.look(cx);
        }
      } catch {}
      this.watching.delete(dir);
    });
  }

  render() {
    return div();
  }
}
