// Spaces and repos for the board, shared by ../board.js and the trackers: which repo a space is in,
// where a board's sessions start (claude-new's { space, folder } props) and their first message.
// Repos come from the hub's own git map (shared `status.git`, ../git.js), so nothing here runs git.
import { spaces, panes, shared } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made. Same as ../git.js.
export function placeOf(space, ps) {
  const tabs = new Set((space.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

// A local space's status.git entry: null outside git, undefined while the hub hasn't looked yet.
function gitOf(space, ps) {
  const at = placeOf(space, ps);
  if (!at) return null;
  const git = shared("status.git") ?? {};
  const key = JSON.stringify([null, at]);
  return key in git ? git[key] : undefined;
}

// The main checkout of a status.git entry's repo: its common git dir without /.git.
function mainOf(entry) {
  const common = JSON.parse(entry.repo)[1];
  return common.endsWith("/.git") ? common.slice(0, -5) : common;
}

// The space's repo (its main checkout); null outside git, and for another machine's space
// (projects.json's keys are this computer's paths); undefined until the hub has looked at it.
export function repoOfSpace(spaceId) {
  const s = spaces().find((x) => x.id === spaceId);
  if (!s || s.machine) return null;
  const entry = gitOf(s, panes());
  return entry ? mainOf(entry) : entry;
}

// The space whose first terminal is in the repo's main checkout `main` (on this computer), as
// { space, folder }; none: { folder: main } (claude-new then makes a worktree of it, or a space there).
export function targetOf(main) {
  const ps = panes();
  for (const s of spaces()) {
    if (s.machine) continue;
    const entry = gitOf(s, ps);
    if (entry && !entry.linked && mainOf(entry) === main) return { space: s.id, folder: entry.top };
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
