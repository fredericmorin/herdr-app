// Prints the Claude Code config dir for a folder's repo (argument, default the current folder):
// projects.json's board.claudeConfig for the repo's main checkout (a worktree uses its repo's) as a
// full path; prints nothing without one or outside git. Exits 1 with the reason on an invalid projects.json.
// Used by ./claude.sh, which every Claude session Herdr starts goes through, and by claude-new's branch
// naming and claude-fork. The Board reads the same setting itself (status-hub/board/config.js).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// projects.json allows // and /* */ comments: blank them outside strings. Same as claude-new's.
const uncomment = (text) =>
  text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : m.replace(/[^\n]/g, " ")));
const absolute = (path) => (path === "~" ? homedir() : path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path);

function mainCheckout(folder) {
  let common;
  try {
    common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
  return common.endsWith("/.git") ? common.slice(0, -5) : common;
}

const folder = process.argv[2] || process.cwd();
// This file is <app home>/mods/claude-new/config-dir.mjs.
const file = fileURLToPath(new URL("../../projects.json", import.meta.url));
let raw;
try { raw = readFileSync(file, "utf8"); } catch { process.exit(0); }
let projects;
try { projects = JSON.parse(uncomment(raw))?.projects ?? {}; } catch (e) {
  console.error(`projects.json: ${e.message}`);
  process.exit(1);
}
const main = mainCheckout(folder);
const key = main ? Object.keys(projects).find((k) => absolute(k) === main) : undefined;
const dir = key ? projects[key]?.board?.claudeConfig : undefined;
if (dir === undefined) process.exit(0);
if (typeof dir !== "string" || !dir.trim()) {
  console.error(`projects.json: ${key}: board.claudeConfig must be a folder path`);
  process.exit(1);
}
console.log(absolute(dir.trim()));
