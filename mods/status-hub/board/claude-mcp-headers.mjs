// The headers Claude Code sends to an HTTP MCP server, as curl config lines on stdout, so the Board can
// call Vikunja's MCP server with the token Claude already has (never on a command line).
//   node claude-mcp-headers.mjs <server url>
// Looks in Claude Code's user-scope servers (`claude mcp add --scope user`): <config dir>/.claude.json,
// where the config dir is $CLAUDE_CONFIG_DIR, else the home folder, as the claude the Board starts reads it.
// Exits 3 with the reason on stderr when no server there has that URL or it sends no headers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(3); };
const bare = (url) => String(url ?? "").replace(/\/+$/, "");

const want = bare(process.argv[2]);
const file = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json");
let config;
try {
  config = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  fail(`Can't read Claude Code's config ${file}: ${e.message}`);
}
const found = Object.entries(config.mcpServers ?? {}).find(([, s]) => bare(s?.url) === want);
if (!found) fail(`No MCP server for ${want} in Claude Code's user config (${file}).`);
const [name, server] = found;
const headers = Object.entries(server.headers ?? {});
if (!headers.length) fail(`Claude Code's "${name}" MCP server sends no headers: add it again with --header "Authorization: Bearer <token>".`);
// JSON's string quoting is curl config's: \" and \\ escaped, UTF-8 kept as is.
for (const [key, value] of headers) process.stdout.write(`header = ${JSON.stringify(`${key}: ${value}`)}\n`);
