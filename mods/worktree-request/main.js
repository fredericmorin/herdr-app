// Opens the worktree dialog (my-worktree) with props, so the project's setup runs and
// worktree-sync leaves the new checkout alone. The request is my-worktree's props
// ({ space, folder, branch, argv, tab }, plus progress: the dialog shows only a spinner), from either:
// - a mod: openOverlay({ mod: "worktree-request", props: { request } }), used by claude-new
//   and claude-fork. It makes the branch at origin's default branch first (the dialog has
//   no base option); without one, <current-branch>_fork, numbered when taken. A branch that
//   exists is reused; one that's already checked out just gets its space shown (opened if none).
// - a script, which `herdr-app do` can't pass props for: it writes
//   ~/.cache/herdr/worktree-request.json (plus `created`, ms) and runs
//   `herdr-app do mod.open --name worktree-request`. Scripts make their branch themselves.
//   Used by ~/.claude/skills/herdr-fork/fork.sh and fanout-run-step/spawn.sh.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { home, exec, run, readTextFile, openOverlay, props, closeOverlay, notify, theme, spaces, panes, checking } from "herdr";

// A request older than this was left behind by a script that gave up: ignore it.
const FRESH = 60_000;

async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on: on ?? undefined });
  return { ok: r.code === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

const inside = (path, dir) => path === dir || path.startsWith(dir + "/");

// The checkout a branch is checked out in, from `git worktree list --porcelain`, and every checkout's path.
async function checkoutOf(top, branch, on) {
  const r = await git(top, ["worktree", "list", "--porcelain"], on);
  if (!r.ok) throw new Error(r.err || "git worktree list failed.");
  const list = [];
  let found = null;
  for (const block of r.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    list.push(path);
    if (lines.includes(`branch refs/heads/${branch}`)) found = path;
  }
  return { found, list };
}

// Shows the checkout's space: the one whose first terminal is in it (not in a checkout nested
// inside it), else a new one there.
function show(path, list, on) {
  const ps = panes();
  const space = spaces().find((s) => {
    if ((s.machine ?? null) !== on) return false;
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const at = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    if (!at || !inside(at, path)) return false;
    return !list.some((o) => o.length > path.length && inside(o, path) && inside(at, o));
  });
  if (space) run("space.select", { id: space.id });
  else run("space.new", { folder: path, machine: on ?? "" });
}

// The branch, made at origin's default branch (or reused), and the checkout's top folder, for a
// mod's request; null when the branch is already checked out, after showing that checkout.
async function prepare(request) {
  const on = spaces().find((s) => s.id === request.space)?.machine ?? null;
  const top = await git(request.folder, ["rev-parse", "--show-toplevel"], on);
  if (!top.ok) throw new Error(`${request.folder} isn't inside a git checkout.`);
  const head = await git(top.out, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], on);
  if (!head.ok) throw new Error(`origin's default branch isn't known in ${top.out}: run \`git remote set-head origin --auto\` there.`);
  const taken = async (b) => (await git(top.out, ["show-ref", "--verify", "--quiet", `refs/heads/${b}`], on)).ok;
  let branch = request.branch?.trim();
  if (branch) {
    if (await taken(branch)) {
      const { found, list } = await checkoutOf(top.out, branch, on);
      if (found) {
        show(found, list, on);
        return null;
      }
      // my-worktree checks out a branch that exists.
      return { ...request, folder: top.out, branch };
    }
  } else {
    const cur = (await git(top.out, ["rev-parse", "--abbrev-ref", "HEAD"], on)).out;
    const stem = !cur || cur === "HEAD" ? `fork_${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}` : `${cur}_fork`;
    branch = stem;
    for (let n = 2; await taken(branch); n++) branch = `${stem}${n}`;
  }
  const made = await git(top.out, ["branch", "--no-track", branch, head.out], on);
  if (!made.ok) throw new Error(made.err || `Couldn't make branch ${branch}.`);
  return { ...request, folder: top.out, branch };
}

export default class WorktreeRequest extends View {
  init(_props, cx) {
    if (checking()) return;
    cx.spawn(async () => {
      try {
        await this.open();
      } catch (e) {
        notify({ title: "Worktree request failed", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(props().overlay);
    });
  }

  async open() {
    if (props()?.request) {
      const request = await prepare(props().request);
      if (request) openOverlay({ mod: "my-worktree", kind: "dialog", width: 440, height: 260, props: { ...request, progress: true } });
      return;
    }
    const file = `${home()}/.cache/herdr/worktree-request.json`;
    const text = await readTextFile(file);
    if (text === null) throw new Error(`No request in ${file}.`);
    // One request, one dialog: a second mod.open must not reuse it.
    await exec("rm", ["-f", file]);
    const { created, ...request } = JSON.parse(text);
    if (!(Date.now() - created < FRESH)) throw new Error(`The request in ${file} is stale.`);
    if (!request.branch) throw new Error("The request has no branch.");
    openOverlay({ mod: "my-worktree", kind: "dialog", width: 440, height: 260, props: { ...request, progress: true } });
  }

  render() {
    const t = theme();
    return v_flex().p(18).bg(t.popover).text_color(t.muted).text_size(13)
      .child(div().child("Opening worktree…"));
  }
}
