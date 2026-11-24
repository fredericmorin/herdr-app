// Which issue board a repo has: its `board` in projects.json, keyed by the repo's main checkout
// (a worktree space shows its repo's board). Each tracker parses what follows its name:
//   "projects": { "~/code/app": { "board": { "vikunja": 16 } } }                       a Vikunja project
//   "projects": { "~/work/api": { "board": { "linear": { "team": "API", "mine": true } } } }  one Linear scope
// "claudeConfig": "~/.claude-personal" beside the tracker: the Claude Code config dir whose MCP server
// (and its token) the Board uses for Vikunja; without it, $CLAUDE_CONFIG_DIR, else ~. Claude sessions
// started in the repo get it too (mods/claude-new/claude.sh).
// Also the GitHub account gh runs as for a repo's pull requests (../reviews.js): its `github.account`.
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
  const file = await readProjects();
  if (file === null) return null;
  const key = keyOf(file, main);
  const board = key ? file.projects[key]?.board : undefined;
  if (board === undefined) return null;
  const names = trackers.filter(t => board?.[t] !== undefined);
  if (names.length !== 1) throw new Error(`projects.json: ${key}: board needs exactly one of ${trackers.join(", ")}`);
  const dir = board.claudeConfig;
  if (dir !== undefined && (typeof dir !== "string" || !dir.trim())) throw new Error(`projects.json: ${key}: board.claudeConfig must be a folder path`);
  return { tracker: names[0], value: board[names[0]], key, claude: dir === undefined ? null : absolute(dir.trim(), home()) };
}

// The GitHub login gh runs as for the repo (its main checkout `main`, null on another machine): the
// project's `github.account`, else the top level's; null: gh's active account. Never another one.
// Throws "projects.json: …" on an invalid file or entry.
export async function githubAccount(main) {
  const file = await readProjects();
  if (file === null) return null;
  const key = main ? keyOf(file, main) : undefined;
  const scopes = [...(key ? [[key, file.projects[key]]] : []), ["the top level", file]];
  for (const [where, scope] of scopes) {
    const account = scope?.github?.account;
    if (account === undefined) continue;
    if (typeof account !== "string" || !/^[A-Za-z0-9-]+$/.test(account))
      throw new Error(`projects.json: ${where}: github.account must be a GitHub login`);
    return account;
  }
  return null;
}

// projects.json, parsed; null when missing.
async function readProjects() {
  const raw = await readTextFile(`${appHome()}/projects.json`);
  if (raw === null) return null;
  try { return JSON.parse(uncomment(raw)) ?? {}; } catch (e) { throw new Error(`projects.json: ${e.message}`); }
}

// The key projects.json gives the repo whose main checkout is `main`.
function keyOf(file, main) {
  return Object.keys(file.projects ?? {}).find(k => absolute(k, home()) === main);
}
