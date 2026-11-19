// Worktree jobs: runs the worktree dialog's creations and removals in the background, so
// closing the dialog (or clicking outside it) doesn't stop them. The dialog (my-worktree)
// checks and asks first, then appends a job to the shared value "worktree-jobs.queue" and closes:
// - { kind: "add", on, top, add, path, tab, argv } (patch project-worktree-settings): `git <add>`
//   run in `top` on machine `on` (null: here), then a space on `path` running `argv`; a toast
//   only when git refuses (the space opening says it worked).
// - { kind: "remove", on, main, top, forced, branch } (patch remove-locked-worktrees):
//   `git worktree remove <forced> <top>` run in the main checkout `main`, then
//   `git branch -D <branch>` when set; a toast either way.
// While jobs run, the block "worktree-jobs-status" (between Spaces and Agents) lists them, from
// the shared value "worktree-jobs.running". Runs as a floating block in my-main that draws nothing.
import { View, div } from "gpui-kit";
import { exec, run, shared, setShared, notify, checking } from "herdr";

const QUEUE = "worktree-jobs.queue";
const RUNNING = "worktree-jobs.running";
const STATUS = "worktree-jobs-status";
// The status block's height: a row per job, plus padding.
const ROW = 24, PAD = 8;

// Shows the status block sized to the running jobs, or hides it when none are left.
function setRunning(list) {
  setShared(RUNNING, list);
  if (list.length === 0) {
    run("layout.hide", { id: STATUS });
    return;
  }
  run("layout.resize", { id: STATUS, px: PAD + ROW * list.length });
  run("layout.show", { id: STATUS });
}

let nextId = 0;
// Runs a job with a row in the status block for as long as it takes.
async function track(verb, name, work) {
  const id = `${Date.now()}-${nextId++}`;
  setRunning([...(shared(RUNNING) ?? []), { id, verb, name, started: Date.now() }]);
  try { return await work(); }
  finally { setRunning((shared(RUNNING) ?? []).filter((j) => j.id !== id)); }
}

const nameOf = (path) => path.replace(/\\/g, "/").split("/").pop();

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, err: (r.stderr || r.stdout || "").trim() };
}

async function add(job) {
  const name = nameOf(job.path);
  const r = await track("Creating", name, () => git(job.top, job.add, job.on, 600_000));
  if (!r.ok) {
    notify({ title: `Couldn't create worktree ${name}`, body: r.err || "git worktree add failed.", level: "error" });
    return;
  }
  // Unnamed, so the space follows the checkout folder and nests under the repo.
  run("space.new", { folder: job.path, machine: job.on ?? "", tab: job.tab, argv: job.argv });
}

async function remove(job) {
  const name = nameOf(job.top);
  const r = await track("Removing", name, () => git(job.main, ["worktree", "remove", ...job.forced, job.top], job.on, 600_000));
  if (!r.ok) {
    notify({ title: `Couldn't remove worktree ${name}`, body: r.err || "git worktree remove failed.", level: "error" });
    return;
  }
  if (!job.branch) {
    notify({ title: `Removed worktree ${name}`, level: "success" });
    return;
  }
  const b = await git(job.main, ["branch", "-D", job.branch], job.on);
  if (b.ok) notify({ title: `Removed worktree ${name}`, body: `Deleted branch ${job.branch} too.`, level: "success" });
  else notify({ title: `Removed worktree ${name}, but couldn't delete branch ${job.branch}`, body: b.err, level: "error" });
}

export default class WorktreeJobs extends View {
  init(_props, cx) {
    if (checking()) return;
    // Nothing runs yet: rows left by a quit go (the queue is persisted, so its jobs run again below).
    setRunning([]);
    cx.timer.every(500, (cx) => {
      const jobs = shared(QUEUE) ?? [];
      if (jobs.length === 0) return;
      setShared(QUEUE, []);
      for (const job of jobs) {
        cx.spawn(async () => {
          try { await (job.kind === "add" ? add(job) : remove(job)); }
          catch (error) { notify({ title: "Worktree job failed", body: String(error?.message ?? error), level: "error" }); }
        });
      }
    });
  }

  render() {
    return div();
  }
}
