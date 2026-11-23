// Vikunja's MCP server (<url>/api/v2/mcp), with the headers (the API token) of the server added to
// Claude Code for that URL (./claude-mcp-headers.mjs).
import { exec, appHome } from "herdr";

// A task's model and effort for Claude are labels ("model/opus", "effort/high"); none is Default (no flag).
export const MODELS = ["fable", "opus", "sonnet", "haiku"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const SETTING = /^(model|effort)\//;

// What labels set for kind ("model" or "effort"): the rest of the first "<kind>/..." title, "" for Default.
export function setting(labels, kind) {
  const title = (labels ?? []).map(l => l.title ?? "").find(t => t.startsWith(`${kind}/`));
  return title ? title.slice(kind.length + 1) : "";
}

// The command that adds Vikunja's MCP server to Claude Code, where the Board looks for it.
export const addCommand = (url) =>
  `claude mcp add --transport http --scope user vikunja ${url}/api/v2/mcp --header "Authorization: Bearer <token>"`;

// status: the HTTP status a tool reported ("404 Not Found: ..."), 0 when Claude Code has no such server, -1 otherwise.
export class McpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// One MCP tools/call. The server is stateless (no session id): every call is a single POST,
// answered as one server-sent event. claude: the Claude Code config dir holding the server, null for the default.
export async function mcp(url, tool, args, claude = null) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
  // curl, not fetch: the app's fetch fails to reach this host (private address) while curl does.
  // The headers go to curl on stdin (-K -), never on a command line; exit 3: no such server in Claude Code.
  const script = 'cfg=$(node "$1" "$2" "$4") || exit 3; printf "%s\\n" "$cfg" | ' +
    'curl -sS -m 20 -K - -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" ' +
    '-H "MCP-Protocol-Version: 2025-06-18" --data "$3" -w "\\n%{http_code}" "$2"';
  const headers = `${appHome()}/mods/status-hub/board/claude-mcp-headers.mjs`;
  const r = await exec("sh", ["-c", script, "sh", headers, `${url}/api/v2/mcp`, body, claude ?? ""]);
  if (r.code === 3) throw new McpError(0, r.stderr.trim());
  if (r.code !== 0) throw new McpError(-1, (r.stderr || `curl exited ${r.code}`).trim());
  const cut = r.stdout.lastIndexOf("\n");
  const status = Number(r.stdout.slice(cut + 1));
  const text = r.stdout.slice(0, cut);
  if (status < 200 || status >= 300) throw new McpError(status, `HTTP ${status}`);
  const data = text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).pop() ?? text;
  const reply = JSON.parse(data);
  if (reply.error) throw new McpError(-1, reply.error.message);
  const out = reply.result?.content?.[0]?.text ?? "";
  if (reply.result?.isError) throw new McpError(Number(out.match(/^(\d{3}) /)?.[1] ?? -1), out);
  return JSON.parse(out);
}
