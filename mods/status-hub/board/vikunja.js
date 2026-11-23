// Vikunja's MCP server (<url>/api/v2/mcp).
// The token is in ~/.config/herdr-app/.vikunja-token (git-ignored).
import { exec, readTextFile, appHome } from "herdr";

// A task's model and effort for Claude are labels ("model/opus", "effort/high"); none is Default (no flag).
export const MODELS = ["fable", "opus", "sonnet", "haiku"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const SETTING = /^(model|effort)\//;

// What labels set for kind ("model" or "effort"): the rest of the first "<kind>/..." title, "" for Default.
export function setting(labels, kind) {
  const title = (labels ?? []).map(l => l.title ?? "").find(t => t.startsWith(`${kind}/`));
  return title ? title.slice(kind.length + 1) : "";
}

// status: the HTTP status a tool reported ("404 Not Found: ..."), 0 without a token, -1 otherwise.
export class McpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// One MCP tools/call. The server is stateless (no session id): every call is a single POST,
// answered as one server-sent event.
export async function mcp(url, tool, args) {
  const file = `${appHome()}/.vikunja-token`;
  if (!((await readTextFile(file)) ?? "").trim()) throw new McpError(0, "no token");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
  // curl, not fetch: the app's fetch fails to reach this host (private address) while curl does.
  // The token goes to curl on stdin (-K -), never on a command line.
  const script = 'printf \'header = "Authorization: Bearer %s"\\n\' "$(tr -d "[:space:]" < "$1")" | ' +
    'curl -sS -m 20 -K - -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" ' +
    '-H "MCP-Protocol-Version: 2025-06-18" --data "$3" -w "\\n%{http_code}" "$2"';
  const r = await exec("sh", ["-c", script, "sh", file, `${url}/api/v2/mcp`, body]);
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
