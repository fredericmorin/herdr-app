// Which issue board a repo has: its `board` in projects.json, keyed by the repo's main checkout
// (a worktree space shows its repo's board). Each tracker parses what follows its name:
//   "projects": { "~/code/app": { "board": { "vikunja": 16 } } }                       a Vikunja project
//   "projects": { "~/work/api": { "board": { "linear": { "team": "API", "mine": true } } } }  one Linear scope
// "claudeConfig": "~/.claude-personal" beside the tracker: the Claude Code config dir whose MCP server
// (and its token) the Board uses for Vikunja; without it, $CLAUDE_CONFIG_DIR, else ~.
import { readTextFile, appHome, home } from "herdr";

// projects.json allows // and /* */ comments: blank them outside strings, keeping line numbers for errors.
// Same as claude-new's (a mod can't import another's files).
const uncomment = (text) =>
  text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : m.replace(/[^\n]/g, " ")));
const absolute = (path, userHome) => (path === "~" ? userHome : path.startsWith("~/") ? `${userHome}${path.slice(1)}` : path);

// A path as projects.json writes it: ~/… under home.
export const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);

// The repo's board entry: { tracker, value, key, claude } (value: what follows the tracker's name, key: the
// repo as projects.json writes it, claude: claudeConfig as a full path or null), null without one.
// Throws "projects.json: …" on an invalid file or entry.
export async function boardEntry(main, trackers) {
  const raw = await readTextFile(`${appHome()}/projects.json`);
  if (raw === null) return null;
  let file;
  try { file = JSON.parse(uncomment(raw)) ?? {}; } catch (e) { throw new Error(`projects.json: ${e.message}`); }
  const key = Object.keys(file.projects ?? {}).find(k => absolute(k, home()) === main);
  const board = key ? file.projects[key]?.board : undefined;
  if (board === undefined) return null;
  const names = trackers.filter(t => board?.[t] !== undefined);
  if (names.length !== 1) throw new Error(`projects.json: ${key}: board needs exactly one of ${trackers.join(", ")}`);
  const dir = board.claudeConfig;
  if (dir !== undefined && (typeof dir !== "string" || !dir.trim())) throw new Error(`projects.json: ${key}: board.claudeConfig must be a folder path`);
  return { tracker: names[0], value: board[names[0]], key, claude: dir === undefined ? null : absolute(dir.trim(), home()) };
}
