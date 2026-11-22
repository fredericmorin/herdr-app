// Which issue board a space shows: its repo's `board` in projects.json, keyed by the repo's main
// checkout (a worktree space shows its repo's board).
//   "projects": { "~/code/app": { "board": { "vikunja": 16 } } }                       a Vikunja project
//   "projects": { "~/work/api": { "board": { "linear": { "team": "API", "mine": true } } } }  one Linear scope
import { readTextFile, appHome, home, spaces, panes } from "herdr";
import { repoOf } from "./target.js";

// projects.json allows // and /* */ comments: blank them outside strings, keeping line numbers for errors.
// Same as claude-new's (a mod can't import another's files).
const uncomment = (text) =>
  text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : m.replace(/[^\n]/g, " ")));
const absolute = (path, userHome) => (path === "~" ? userHome : path.startsWith("~/") ? `${userHome}${path.slice(1)}` : path);

// A path as projects.json writes it: ~/… under home.
export const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);

// The space's repo (its main checkout), from where its first terminal is now; null outside git.
export async function repoOfSpace(spaceId) {
  const s = spaces().find(x => x.id === spaceId);
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map(c => c.id));
  const at = panes().find(p => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
  const repo = at ? await repoOf(at, s.machine ?? undefined) : null;
  return repo ? { main: repo.main, machine: s.machine ?? null } : null;
}

// The repo's board entry: { tracker, value } (value: what follows the tracker's name), null without one.
// Throws "projects.json: …" on an invalid file or entry.
export async function boardOf(main) {
  const raw = await readTextFile(`${appHome()}/projects.json`);
  if (raw === null) return null;
  let file;
  try { file = JSON.parse(uncomment(raw)) ?? {}; } catch (e) { throw new Error(`projects.json: ${e.message}`); }
  const key = Object.keys(file.projects ?? {}).find(k => absolute(k, home()) === main);
  const board = key ? file.projects[key]?.board : undefined;
  if (board === undefined) return null;
  const trackers = ["vikunja", "linear"].filter(t => board?.[t] !== undefined);
  if (trackers.length !== 1) throw new Error(`projects.json: ${key}: board needs exactly one of vikunja, linear`);
  return { tracker: trackers[0], value: board[trackers[0]], key };
}
