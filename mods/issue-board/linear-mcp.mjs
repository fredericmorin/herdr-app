// Linear's hosted MCP server (https://mcp.linear.app/mcp) for the Board: OAuth sign-in and tool calls.
// Personal API keys are blocked in the workspace, so this signs in like an MCP client: dynamic client
// registration, then authorization code + PKCE through a callback on 127.0.0.1. Node built-ins only.
// The token is in <app home>/.linear-mcp.json (0600, git-ignored), apart from other Linear clients':
// refresh tokens rotate, so a shared file would sign the other one out.
//   node linear-mcp.mjs login              opens the browser, waits up to 5 minutes for the sign-in
//   node linear-mcp.mjs status             {"ok":true,"signedIn":bool}
//   node linear-mcp.mjs tools              the server's tools/list
//   node linear-mcp.mjs batch '<json>'     [{tool, args}] in one session, in parallel
//   node linear-mcp.mjs call <tool> '<json>'
// Always prints one JSON line: {ok:true, ...} or {ok:false, status, error}. status: 0 not signed in
// (run login), 401 refused, 429 rate-limited, -1 anything else. batch gives each call its own
// {ok, value} or {ok:false, status, error}, plus ms and calls for the whole run.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = "https://mcp.linear.app";
const RESOURCE = `${BASE}/mcp`;
const PROTOCOL = "2025-06-18";
const SCOPE = "read write";
// This file sits in <app home>/mods/<mod>/.
const APP_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOKEN = path.join(APP_HOME, ".linear-mcp.json");
const LOCK = `${TOKEN}.lock`;
const LOGIN_WAIT = 5 * 60_000;

class Fail extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const b64url = (buf) => buf.toString("base64url");

async function endpoints() {
  try {
    const r = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    if (r.ok) {
      const m = await r.json();
      return { register: m.registration_endpoint, authorize: m.authorization_endpoint, token: m.token_endpoint };
    }
  } catch {}
  return { register: `${BASE}/register`, authorize: `${BASE}/authorize`, token: `${BASE}/token` };
}

async function readToken() {
  try { return JSON.parse(await fs.readFile(TOKEN, "utf8")); } catch { return null; }
}

async function saveToken(t) {
  const tmp = `${TOKEN}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(t), { mode: 0o600 });
  await fs.rename(tmp, TOKEN);
}

async function postForm(url, fields) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString() });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!r.ok) throw new Fail(r.status, `${url}: HTTP ${r.status} ${body?.error_description || body?.error || text.slice(0, 200)}`);
  return body;
}

const withExpiry = (reply, clientId, old) => ({
  client_id: clientId,
  access_token: reply.access_token,
  // Some servers keep the refresh token unchanged and leave it out of the reply.
  refresh_token: reply.refresh_token ?? old?.refresh_token ?? null,
  expires_at: reply.expires_in ? Date.now() + reply.expires_in * 1000 : null,
});

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}

async function login() {
  const ep = await endpoints();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  let finish;
  const code = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") { res.writeHead(404).end(); return; }
    const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ok ? "<p>Signed in to Linear for the Herdr Board. You can close this tab.</p>"
      : `<p>Linear sign-in failed: ${url.searchParams.get("error_description") || url.searchParams.get("error") || "bad state"}.</p>`);
    if (ok) finish.resolve(url.searchParams.get("code"));
    else finish.reject(new Fail(-1, `sign-in failed: ${url.searchParams.get("error") || "state mismatch"}`));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const timer = setTimeout(() => finish.reject(new Fail(-1, "sign-in timed out")), LOGIN_WAIT);
  try {
    const r = await fetch(ep.register, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_name: "Herdr Board", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], token_endpoint_auth_method: "none" }) });
    if (!r.ok) throw new Fail(r.status, `client registration: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const reg = await r.json();
    openBrowser(`${ep.authorize}?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect,
      code_challenge: challenge, code_challenge_method: "S256", state, scope: SCOPE, resource: RESOURCE })}`);
    const reply = await postForm(ep.token, { grant_type: "authorization_code", code: await code, redirect_uri: redirect,
      client_id: reg.client_id, code_verifier: verifier, resource: RESOURCE });
    await saveToken(withExpiry(reply, reg.client_id, null));
  } finally {
    clearTimeout(timer);
    server.close();
  }
  return {};
}

// One refresh at a time across helper runs: a rotated refresh token works once, so a second runner
// waits, then reads what the first one saved.
async function locked(fn) {
  for (let i = 0; ; i++) {
    try {
      const h = await fs.open(LOCK, "wx");
      try { return await fn(); } finally { await h.close(); await fs.rm(LOCK, { force: true }); }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const st = await fs.stat(LOCK).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 15_000) await fs.rm(LOCK, { force: true });
      else if (i > 150) throw new Fail(-1, "token refresh lock held too long");
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function refresh(stale) {
  return locked(async () => {
    const t = await readToken();
    if (!t) throw new Fail(0, "not signed in to Linear");
    // Another run already refreshed it.
    if (t.access_token !== stale.access_token) return t;
    if (!t.refresh_token) throw new Fail(0, "Linear sign-in expired");
    const ep = await endpoints();
    let reply;
    try {
      reply = await postForm(ep.token, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, resource: RESOURCE });
    } catch (e) {
      if (e.status === 400 || e.status === 401) throw new Fail(0, "Linear sign-in expired");
      throw e;
    }
    const next = withExpiry(reply, t.client_id, t);
    await saveToken(next);
    return next;
  });
}

async function token() {
  const t = await readToken();
  if (!t?.access_token) throw new Fail(0, "not signed in to Linear");
  if (t.expires_at && t.expires_at - 60_000 < Date.now()) return refresh(t);
  return t;
}

// A JSON-RPC reply, from plain JSON or a server-sent event stream.
function parseReply(text, type, id) {
  if (!text.trim()) return null;
  if (!(type ?? "").includes("text/event-stream")) return JSON.parse(text);
  const messages = text.split(/\r?\n\r?\n/).map((ev) => ev.split(/\r?\n/).filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart()).join("\n")).filter(Boolean).map((d) => { try { return JSON.parse(d); } catch { return null; } }).filter(Boolean);
  return messages.find((m) => m.id === id) ?? messages.pop() ?? null;
}

async function post(t, session, message) {
  const r = await fetch(RESOURCE, { method: "POST", headers: {
    Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL, ...(session ? { "Mcp-Session-Id": session } : {}) }, body: JSON.stringify(message) });
  const text = await r.text();
  if (r.status === 401) throw new Fail(401, "Linear refused the token");
  if (r.status === 429) throw new Fail(429, "Linear is rate-limiting");
  if (!r.ok) throw new Fail(-1, `MCP: HTTP ${r.status} ${text.slice(0, 200)}`);
  return { session: r.headers.get("mcp-session-id") ?? session, reply: parseReply(text, r.headers.get("content-type"), message.id) };
}

// Opens a session, refreshing the token once if the server refuses it.
async function open() {
  let t = await token();
  const hello = { jsonrpc: "2.0", id: 0, method: "initialize",
    params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "herdr-board", version: "1" } } };
  let init;
  try {
    init = await post(t, null, hello);
  } catch (e) {
    if (e.status !== 401) throw e;
    t = await refresh(t);
    init = await post(t, null, hello);
  }
  if (init.reply?.error) throw new Fail(-1, `initialize: ${init.reply.error.message}`);
  await post(t, init.session, { jsonrpc: "2.0", method: "notifications/initialized" });
  return { t, session: init.session };
}

async function close({ t, session }) {
  if (!session) return;
  try { await fetch(RESOURCE, { method: "DELETE", headers: { Authorization: `Bearer ${t.access_token}`, "Mcp-Session-Id": session } }); } catch {}
}

// What a tool returned: its structured content, else its text parsed as JSON, else the text.
function valueOf(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try { return JSON.parse(text); } catch { return text; }
}

function toolError(text) {
  const s = String(text ?? "").replace(/^Error:\s*/, "");
  const status = /rate.?limit|\b429\b/i.test(s) ? 429 : /\b401\b|unauthori[sz]ed/i.test(s) ? 401 : -1;
  return { ok: false, status, error: s.slice(0, 500) };
}

async function callAll(s, calls) {
  let id = 0;
  return Promise.all(calls.map(async ({ tool, args }) => {
    try {
      const { reply } = await post(s.t, s.session, { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: tool, arguments: args ?? {} } });
      if (reply?.error) return toolError(reply.error.message);
      if (reply?.result?.isError) return toolError(valueOf(reply.result));
      return { ok: true, value: valueOf(reply?.result) };
    } catch (e) {
      return { ok: false, status: e.status ?? -1, error: e.message };
    }
  }));
}

function parseArg(raw, what) {
  try { return JSON.parse(raw ?? ""); } catch { throw new Fail(-1, `${what} must be JSON`); }
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const started = Date.now();
  if (cmd === "login") return login();
  if (cmd === "status") return { signedIn: Boolean((await readToken())?.access_token) };
  if (cmd === "tools") {
    const s = await open();
    try {
      const { reply } = await post(s.t, s.session, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      return { tools: reply?.result?.tools ?? [] };
    } finally { await close(s); }
  }
  if (cmd === "batch" || cmd === "call") {
    const calls = cmd === "batch" ? parseArg(a, "batch") : [{ tool: a, args: parseArg(b ?? "{}", "args") }];
    if (!Array.isArray(calls)) throw new Fail(-1, "batch must be a JSON array of {tool, args}");
    const s = await open();
    try {
      const results = await callAll(s, calls);
      // A whole-run refusal (every call rate-limited or refused) is the run's own status.
      const all = results.length > 0 && results.every((r) => !r.ok && r.status === results[0].status && r.status > 0);
      if (all) throw new Fail(results[0].status, results[0].error);
      if (cmd === "call") {
        if (!results[0].ok) throw new Fail(results[0].status, results[0].error);
        return { value: results[0].value };
      }
      return { results, calls: results.length, ms: Date.now() - started };
    } finally { await close(s); }
  }
  throw new Fail(-1, "usage: linear-mcp.mjs login | status | tools | batch '<json>' | call <tool> '<json>'");
}

main().then(
  (out) => { process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`); },
  (e) => { process.stdout.write(`${JSON.stringify({ ok: false, status: e.status ?? -1, error: e.message })}\n`); process.exitCode = 1; });
