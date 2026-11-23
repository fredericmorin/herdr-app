// Worktree sync: a space, in the background, for each checkout (git worktree) that
// appears in a repo with a space open, whoever made it (git, an agent, another app).
// It remembers the checkouts it has seen, so a repo's checkouts at first sight are
// left to "Open all worktrees", and a space you close stays closed. Branches that
// my-worktree claims are left alone: it opens their space itself. Draws nothing.

import { View, div } from "gpui-kit";
import { spaces, panes, run, shared, checking } from "herdr";

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

export default class WorktreeSync extends View {
  init(_props, _cx) {
    if (checking()) return;
    // repo -> the checkout paths seen last time; JSON [machine, git common dir] keys.
    try { this.seen = JSON.parse(localStorage.getItem("seen") ?? "{}"); } catch { this.seen = {}; }
    this.snapshot = "";
  }

  // The repos in view (status hub ids), each with the hub's checkout list; missing ones not listed yet.
  inView() {
    const git = shared("status.git") ?? {};
    const worktrees = shared("status.worktrees") ?? {};
    const ps = panes();
    const repos = new Map();
    for (const s of spaces()) {
      const at = place(s, ps);
      if (!at) continue;
      const repo = git[JSON.stringify([s.machine ?? null, at])]?.repo;
      if (repo && worktrees[repo]) repos.set(repo, worktrees[repo]);
    }
    return repos;
  }

  sync() {
    const now = Date.now();
    const claims = shared("worktree-sync.claims") ?? {};
    const sp = spaces(), ps = panes();
    for (const [key, list] of this.inView()) {
      const on = JSON.parse(key)[0];
      const known = this.seen[key];
      if (known) {
        for (const c of list) {
          if (known.includes(c.path)) continue;
          const claimed = c.branch !== null && now - (claims[c.branch] ?? 0) < CLAIM;
          if (!claimed && !hasSpace(c, list, on, sp, ps)) run("space.new", { folder: c.path, machine: on ?? "", focus: false });
        }
      }
      this.seen[key] = list.map((c) => c.path);
    }
    try { localStorage.setItem("seen", JSON.stringify(this.seen)); } catch {}
  }

  render(cx) {
    if (this.seen) {
      const snapshot = JSON.stringify([...this.inView()]);
      if (snapshot !== this.snapshot) {
        this.snapshot = snapshot;
        cx.timer.after(0, () => this.sync());
      }
    }
    return div();
  }
}
