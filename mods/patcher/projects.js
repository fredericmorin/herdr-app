// Keeps ~/.config/herdr-app/projects.json (per-project settings read by patched mods) present,
// with a commented reference at its top. Update REFERENCE whenever a patch adds or changes a setting.

import { appHome, readTextFile, writeTextFile } from "herdr";

const START = "// ---- Reference (kept current by mods/patcher at every start; edits inside are replaced) ----";
const END = "// ---- End of reference ----";
const REFERENCE = `${START}
// Per-project settings for Herdr. // and /* */ comments are allowed anywhere in this file.
//
// {
//   "worktrees": {                             // defaults for every repo; a project's own setting wins
//     "deleteBranch": true
//   },
//   "board_start": { ... },                    // defaults for every repo, same shape as a project's
//   "new_session": { ... },
//   "projects": {
//     "~/code/app": {                          // the repo's main checkout (absolute or ~/)
//       "worktrees": {                         // New worktree, in this repo
//         "directory": "~/code/app/.worktrees", // where checkouts go: <directory>/<branch>; default <settings.json worktrees.directory>/<repo>/<branch>
//         "setup": "direnv allow",             // sh script run in each new worktree's first terminal, before any agent
//         "deleteBranch": true                 // Remove worktree also deletes its branch (git branch -D); default: top-level worktrees.deleteBranch, else false
//       },
//       "board_start": { "worktree": true, "plan": true },  // New Claude session's boxes on Board Start; default: top-level
//                                                           // board_start, else both ticked (Plan unticked for a card in Plan)
//       "new_session": { "worktree": true, "plan": false }  // ... on Cmd+Shift+N and New worktree; default: top-level
//                                                           // new_session, else worktree ticked, plan not
//     }
//   }
// }
${END}`;
const EMPTY = `{\n  "projects": {}\n}\n`;
// The existing block: from a line starting like START (its wording may be older) through END.
const BLOCK = /^\/\/ ---- Reference\b[^\n]*\n[\s\S]*?^\/\/ ---- End of reference ----[^\n]*/m;

// Creates the file if missing, adds the reference if absent, replaces it if out of date.
export async function ensureProjects() {
  const path = `${appHome()}/projects.json`;
  const old = await readTextFile(path);
  let text;
  if (old === null) text = `${REFERENCE}\n${EMPTY}`;
  else if (BLOCK.test(old)) text = old.replace(BLOCK, () => REFERENCE);
  else text = `${REFERENCE}\n${old}`;
  if (text !== old) await writeTextFile(path, text, old);
}
