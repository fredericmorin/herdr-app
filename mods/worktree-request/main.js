// Opens the worktree dialog (my-worktree) with props, so the project's setup runs and
// worktree-sync leaves the new checkout alone. The request is my-worktree's props
// ({ space, folder, branch, argv, tab }), from either:
// - a mod: openOverlay({ mod: "worktree-request", props: { request } }), used by claude-new
//   and claude-fork. It makes the branch at origin's default branch first (the dialog has
//   no base option); without one, <current-branch>_fork, numbered when taken.
// - a script, which `herdr-app do` can't pass props for: it writes
//   ~/.cache/herdr/worktree-request.json (plus `created`, ms) and runs
//   `herdr-app do mod.open --name worktree-request`. Scripts make their branch themselves.
//   Used by ~/.claude/skills/herdr-fork/fork.sh and fanout-run-step/spawn.sh.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { home, exec, readTextFile, openOverlay, props, closeOverlay, notify, theme, spaces, checking } from "herdr";

// A request older than this was left behind by a script that gave up: ignore it.
const FRESH = 60_000;

async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on: on ?? undefined });
  return { ok: r.code === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

// The branch, made at origin's default branch, and the checkout's top folder, for a mod's request.
async function prepare(request) {
  const on = spaces().find((s) => s.id === request.space)?.machine ?? null;
  const top = await git(request.folder, ["rev-parse", "--show-toplevel"], on);
  if (!top.ok) throw new Error(`${request.folder} isn't inside a git checkout.`);
  const head = await git(top.out, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], on);
  if (!head.ok) throw new Error(`origin's default branch isn't known in ${top.out}: run \`git remote set-head origin --auto\` there.`);
  const taken = async (b) => (await git(top.out, ["show-ref", "--verify", "--quiet", `refs/heads/${b}`], on)).ok;
  let branch = request.branch?.trim();
  if (branch) {
    if (await taken(branch)) throw new Error(`Branch ${branch} already exists.`);
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
      openOverlay({ mod: "my-worktree", kind: "dialog", width: 440, height: 260, props: await prepare(props().request) });
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
    openOverlay({ mod: "my-worktree", kind: "dialog", width: 440, height: 260, props: request });
  }

  render() {
    const t = theme();
    return v_flex().p(18).bg(t.popover).text_color(t.muted).text_size(13)
      .child(div().child("Opening worktree…"));
  }
}
