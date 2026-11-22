// Spaces and repos for the board, shared by main.js and the trackers: which repo a space is in,
// where a board's sessions start (claude-new's { space, folder } props) and their first message.
import { exec, spaces, panes } from "herdr";

// The repo a folder belongs to: its main checkout, and whether the folder is a linked worktree.
// null outside git. Same as Herdr's worktree dialog's repoOf (a mod can't import another's files).
export async function repoOf(folder) {
  const git = async (args) => {
    const r = await exec("git", args, { cwd: folder });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim() };
  };
  const top = await git(["rev-parse", "--show-toplevel"]);
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, linked: main !== top.out };
}

// Where a space is now: its first terminal's live folder, else where it was made.
function placeOf(space, ps) {
  const tabs = new Set((space.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

// The space's repo (its main checkout); null outside git, and for another machine's space
// (projects.json's keys are this computer's paths).
export async function repoOfSpace(spaceId) {
  const s = spaces().find((x) => x.id === spaceId);
  if (!s || s.machine) return null;
  const at = placeOf(s, panes());
  return at ? (await repoOf(at))?.main ?? null : null;
}

// The space whose first terminal is in the repo's main checkout `main` (on this computer), as
// { space, folder }; none: { folder: main } (claude-new then makes a worktree of it, or a space there).
export async function targetOf(main) {
  const ps = panes();
  for (const s of spaces()) {
    if (s.machine) continue;
    const at = placeOf(s, ps);
    // Spaces outside the repo can't be it: skips git for them.
    if (!(at === main || at?.startsWith(`${main}/`))) continue;
    const repo = await repoOf(at);
    if (repo && repo.main === main && !repo.linked) return { space: s.id, folder: repo.top };
  }
  return { folder: main };
}

// A Start's first message: the heading, description, labels and link, then the ticket line the
// session's skill reads (vikunja-ticket, linear-ticket). Runs of blank lines become one.
export function ticketMessage({ heading, description, labels, url, ticket }) {
  const lines = [heading, "", (description ?? "").trim(), "",
    ...(labels.length ? [`Labels: ${labels.join(", ")}`] : []), url, "", ticket];
  return lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n").trim();
}
