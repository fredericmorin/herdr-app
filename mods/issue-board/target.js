// Where a chip's sessions start (claude-new's { space, folder } props), shared by the trackers.
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

// The space whose first terminal is in a repo's main checkout, as { space, folder }. Only worktree
// spaces of it: { folder } (its main checkout, no space). match { name }: spaces named like it (a
// Vikunja project), none: null (claude-new then uses the focused space). match { main }: that repo's
// main checkout on this computer (a Linear chip's repo), none: { folder: main }.
export async function targetOf(match) {
  const name = (match.name ?? "").trim().toLowerCase();
  const ps = panes();
  let fallback = null;
  for (const s of spaces()) {
    if (match.name !== undefined && (s.name ?? "").trim().toLowerCase() !== name) continue;
    if (match.main && s.machine) continue;
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const at = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    // Spaces outside the repo can't be it: skips git for them.
    if (match.main && !(at === match.main || at?.startsWith(`${match.main}/`))) continue;
    const repo = at ? await repoOf(at, s.machine ?? undefined) : null;
    if (!repo || (match.main && repo.main !== match.main)) continue;
    if (!repo.linked) return { space: s.id, folder: repo.top };
    fallback ??= { folder: repo.main };
  }
  return fallback ?? (match.main ? { folder: match.main } : null);
}
