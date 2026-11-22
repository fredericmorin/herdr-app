// Linear's MCP server through ./linear-mcp.mjs (Node: OAuth sign-in, one MCP session per run).
import { exec, appHome } from "herdr";

// status: 0 not signed in (run login), 401 refused, 429 rate-limited, -1 anything else.
export class LinearError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function helper(args, timeout = 60_000) {
  const r = await exec("node", [`${appHome()}/mods/issue-board/linear-mcp.mjs`, ...args], { timeout });
  let out;
  try {
    out = JSON.parse((r.stdout ?? "").trim().split("\n").pop());
  } catch {
    throw new LinearError(-1, (r.stderr || r.stdout || `node exited ${r.code}`).trim().slice(0, 300));
  }
  if (!out.ok) throw new LinearError(out.status ?? -1, out.error);
  return out;
}

// Several tool calls in one session, in parallel: [{tool, args}] -> [{ok, value} | {ok: false, status, error}].
export async function linearBatch(calls) {
  return (await helper(["batch", JSON.stringify(calls)])).results;
}

// One tool call: its value, or a LinearError.
export async function linear(tool, args) {
  return (await helper(["call", tool, JSON.stringify(args ?? {})])).value;
}

// Opens the browser and waits for the sign-in (the helper gives up after 5 minutes).
export async function linearLogin() {
  await helper(["login"], 310_000);
}
