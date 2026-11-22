// Where a board's sessions start (claude-new's { space, folder } props), shared by the trackers.
import { exec, spaces, panes } from "herdr";

// The repo a folder belongs to: its main checkout, and whether the folder is a linked worktree.
// null outside git. Same as Herdr's worktree dialog's repoOf (a mod can't import another's files).
export async function repoOf(folder, on) {
  const git = async (args) => {
    const r = await exec("git", args, { cwd: folder, on });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim() };
  };
  const top = await git(["rev-parse", "--show-toplevel"]);
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, linked: main !== top.out };
}

// The space whose first terminal is in the repo's main checkout `main` (on this computer), as
// { space, folder }; none: { folder: main } (claude-new then makes a worktree of it, or a space there).
export async function targetOf(main) {
  const ps = panes();
  for (const s of spaces()) {
    if (s.machine) continue;
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const at = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    // Spaces outside the repo can't be it: skips git for them.
    if (!(at === main || at?.startsWith(`${main}/`))) continue;
    const repo = await repoOf(at);
    if (repo && repo.main === main && !repo.linked) return { space: s.id, folder: repo.top };
  }
  return { folder: main };
}
