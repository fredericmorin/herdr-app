// Settings → Projects: edits ~/.config/herdr-app/projects.json, the per-project settings read by the
// patched worktree dialog (worktrees), claude-new (board_start, new_session) and the Board (board).
// mods/patcher installs it from mods/patcher/files/ beside the Settings screen; its settings-projects
// patch hooks it in. Every setting here is also in REFERENCE in mods/patcher/projects.js: keep both in step.
// Each change is written at once (no Save step), like the rest of Settings: the reference block at the
// top stays as it is, and the rest is rewritten as plain JSON (hand comments below it are dropped).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { appHome, home, exec, focused, spaces, readTextFile, writeTextFile, pickFolder, notify } from "herdr";

// The Board's Vikunja server (its default in mods/issue-board/main.js).
const VIKUNJA = "https://todo.endor.one";
const SPINNER = "mods/workspace-chrome/spinner.svg";
const CLEAR = "#00000000";

// projects.json allows // and /* */ comments: blank them outside strings. Same as claude-new's
// (a mod can't import another's files).
const uncomment = (text) =>
  text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : m.replace(/[^\n]/g, " ")));
// The reference block mods/patcher/projects.js keeps at the top: the same regex as there.
const BLOCK = /^\/\/ ---- Reference\b[^\n]*\n[\s\S]*?^\/\/ ---- End of reference ----[^\n]*/m;
const absolute = (path) => (path === "~" ? home() : path.startsWith("~/") ? `${home()}${path.slice(1)}` : path);
const tilde = (path) => (path === home() ? "~" : path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// The yes/no settings, at the top level (defaults) and in each project. `builtIn`: what the reader
// does when neither sets it.
const FLAGS = [
  { group: "worktrees", name: "deleteBranch", title: "Delete branch on remove",
    about: "Remove worktree also deletes the worktree's branch (git branch -D).", builtIn: false },
  { group: "board_start", name: "worktree", title: "Board Start: new worktree",
    about: "Start a ticket's Claude session in a new worktree.", builtIn: true },
  { group: "board_start", name: "plan", title: "Board Start: Plan mode",
    about: "Start a ticket's session in Plan mode. A card already in Plan always starts without it.", builtIn: true },
  { group: "new_session", name: "worktree", title: "New session: new worktree",
    about: "Cmd+Shift+N and New worktree start the Claude session in a new worktree.", builtIn: true },
  { group: "new_session", name: "plan", title: "New session: Plan mode",
    about: "Cmd+Shift+N and New worktree start the Claude session in Plan mode.", builtIn: false },
];
const GROUPS = ["worktrees", "board_start", "new_session", "board"];
const TRACKERS = [[null, "None"], ["vikunja", "Vikunja"], ["linear", "Linear"]];
// A Linear board's scope: the key it sets in "linear": { … }.
const KINDS = [["mine", "My issues"], ["cycle", "Team cycle"], ["project", "Project"], ["view", "View"]];
const linearUrl = (kind, url) =>
  new RegExp(`linear\\.app/[^/]+/${kind}/(?:[^/?#]*-)?[0-9a-f]{12}(?:[/?#]|$)`, "i").test(String(url ?? ""));

// The repo's main checkout for a folder on this computer, or null outside git.
async function mainCheckout(folder) {
  if (!folder) return null;
  try {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: absolute(folder) });
    const common = (r.stdout ?? "").trim();
    if (r.code !== 0 || !common) return null;
    return common.endsWith("/.git") ? common.slice(0, -5) : common;
  } catch {
    return null;
  }
}

// One Vikunja MCP tools/call, as the Board makes it (mods/issue-board/vikunja.js): curl, with the
// token from .vikunja-token on stdin, never on a command line.
async function vikunja(tool, args) {
  const file = `${appHome()}/.vikunja-token`;
  if (!((await readTextFile(file)) ?? "").trim()) throw new Error(`No Vikunja token in ${tilde(file)}.`);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
  const script = 'printf \'header = "Authorization: Bearer %s"\\n\' "$(tr -d "[:space:]" < "$1")" | ' +
    'curl -sS -m 20 -K - -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" ' +
    '-H "MCP-Protocol-Version: 2025-06-18" --data "$3" -w "\\n%{http_code}" "$2"';
  const r = await exec("sh", ["-c", script, "sh", file, `${VIKUNJA}/api/v2/mcp`, body]);
  if (r.code !== 0) throw new Error((r.stderr || `curl exited ${r.code}`).trim());
  const cut = r.stdout.lastIndexOf("\n");
  const status = Number(r.stdout.slice(cut + 1));
  const text = r.stdout.slice(0, cut);
  if (status < 200 || status >= 300) throw new Error(`Vikunja answered HTTP ${status}.`);
  const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? text;
  const reply = JSON.parse(data);
  if (reply.error) throw new Error(reply.error.message);
  const out = reply.result?.content?.[0]?.text ?? "";
  if (reply.result?.isError) throw new Error(out);
  return JSON.parse(out);
}

// One Linear MCP tool call through the Board's helper (a separate Node process, signed in from the Board).
async function linear(tool, args) {
  const r = await exec("node", [`${appHome()}/mods/issue-board/linear-mcp.mjs`, "call", tool, JSON.stringify(args)], { timeout: 60_000 });
  let out;
  try {
    out = JSON.parse((r.stdout ?? "").trim().split("\n").pop());
  } catch {
    throw new Error((r.stderr || r.stdout || `node exited ${r.code}`).trim().slice(0, 300));
  }
  if (!out.ok) throw new Error(out.status === 0 ? "Not signed in to Linear: sign in from the Board." : out.error);
  return out.value;
}

// Every Vikunja project as "Parent › Child", for the Board's project picker.
async function vikunjaProjects() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const r = await vikunja("projects_list", { fields: ["id", "title", "parent_project_id"], page });
    all.push(...(r.items ?? []).filter((p) => p.id > 0));
    if (page >= (r.total_pages ?? 1)) break;
  }
  const byId = new Map(all.map((p) => [p.id, p]));
  const path = (p) => {
    const names = [];
    for (let q = p, n = 0; q && n < 10; q = byId.get(q.parent_project_id), n++) names.unshift(q.title);
    return names.join(" › ");
  };
  return all.map((p) => ({ value: p.id, label: path(p), detail: `#${p.id}` })).sort((a, b) => a.label.localeCompare(b.label));
}

// Drops empty groups ({}), at the top and in each project; an empty project stays (it was added).
function prune(file) {
  for (const scope of [file, ...Object.values(isObject(file.projects) ? file.projects : {})]) {
    if (!isObject(scope)) continue;
    for (const g of GROUPS) if (isObject(scope[g]) && !Object.keys(scope[g]).length) delete scope[g];
  }
}

export class ProjectsSection {
  // host: the Settings view, for its heading/row/button helpers and settings.json (`person`).
  constructor(host, cx) {
    this.host = host;
    this.raw = undefined;   // projects.json's text, null when missing, undefined until read
    this.file = null;       // the parsed file, null while unread or broken
    this.error = "";        // why projects.json can't be edited
    this.selected = null;   // "" for the defaults, else a project key; null until the first read
    this.here = null;       // the focused space's project key, if it has one
    this.repos = null;      // local spaces' repos (main checkouts), for Add project
    this.adding = false;
    this.removing = false;
    this.draft = null;      // { key, tracker, linear? }: a board choice that needs a pick before it's written
    this.lists = {};        // pickers' items by name: "loading", { items } or { error }
    this.queue = Promise.resolve(); // writes, in order
    this.focus = "";        // the text field that has the keyboard
    this.shown = {};        // what fill() put in each text field
    this.inputs = {
      directory: InputState.new({ placeholder: "" }),
      setup: TextareaState.new({ placeholder: "None", rows: 2 }),
      vikunja: InputState.new({ placeholder: "Project id" }),
      team: InputState.new({ placeholder: "Team key" }),
      url: InputState.new({ placeholder: "https://linear.app/…" }),
      title: InputState.new({ placeholder: "From the scope" }),
    };
    this.inputs.setup.set_auto_grow(2, 8);
    for (const [field, state] of Object.entries(this.inputs)) {
      state.on("change", (_e, cx) => this.typed(field, cx));
      state.on("focus", (_e, cx) => { this.focus = field; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focus === field) this.focus = ""; cx.notify(); });
    }
    this.reload(cx);
  }

  projects() {
    return isObject(this.file?.projects) ? this.file.projects : {};
  }

  keyOf(repo) {
    return Object.keys(this.projects()).find((k) => absolute(k) === repo) ?? null;
  }

  // Reads projects.json again (Settings calls this when the section is picked): hand edits show.
  reload(cx) {
    cx.spawn(async (cx) => {
      await this.load();
      if (this.selected === null) {
        this.here = this.keyOf(await mainCheckout(focused()?.cwd));
        this.selected = this.here ?? "";
      } else if (this.selected && !(this.selected in this.projects())) this.selected = "";
      this.fill();
      this.lookUp(cx);
      cx.notify();
      const repos = [];
      for (const s of spaces()) {
        if (s.machine) continue; // projects.json keys are this computer's paths
        const repo = await mainCheckout(s.folder);
        if (repo && !repos.includes(repo)) repos.push(repo);
      }
      this.repos = repos;
      cx.notify();
    });
  }

  async load() {
    this.raw = await readTextFile(`${appHome()}/projects.json`);
    try {
      const body = uncomment(this.raw ?? "").trim();
      const file = body ? JSON.parse(body) : {};
      if (!isObject(file)) throw new Error("it isn't a JSON object.");
      if (file.projects !== undefined && !isObject(file.projects)) throw new Error('"projects" isn\'t an object.');
      this.file = file;
      this.error = "";
    } catch (e) {
      this.file = null;
      this.error = String(e?.message ?? e);
    }
  }

  // Applies edit(file) and writes projects.json, after the writes already asked for. Like Settings'
  // save(): read, edit, write only if nobody changed it meanwhile (else read again and redo).
  change(edit, cx) {
    const write = this.queue.then(() => this.save(edit));
    this.queue = write.catch(() => {});
    cx.spawn(async (cx) => {
      const failed = await write;
      if (failed) notify({ ...failed, level: "error" });
      cx.notify();
    });
  }

  // The toast saying why `edit` wasn't written, or null once it is.
  async save(edit) {
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.load();
      if (this.error) return { title: "projects.json has errors: fix it first", body: this.error };
      const next = JSON.parse(JSON.stringify(this.file));
      edit(next);
      prune(next);
      const head = this.raw?.match(BLOCK);
      const text = `${head ? `${this.raw.slice(0, head.index + head[0].length)}\n` : ""}${JSON.stringify(next, null, 2)}\n`;
      if (text === this.raw) return null;
      try {
        await writeTextFile(`${appHome()}/projects.json`, text, this.raw);
        this.raw = text;
        this.file = next;
        return null;
      } catch (e) {
        error = e;
      }
    }
    return { title: "Not saved to projects.json", body: String(error?.message ?? error) };
  }

  // The settings object for key in file: the file itself for the defaults, created for a project.
  static scope(file, key) {
    if (!key) return file;
    if (!isObject(file.projects)) file.projects = {};
    if (!isObject(file.projects[key])) file.projects[key] = {};
    return file.projects[key];
  }

  // Sets group.name in key's settings (undefined removes it).
  set(key, group, name, value, cx) {
    this.change((f) => {
      const s = ProjectsSection.scope(f, key);
      if (!isObject(s[group])) s[group] = {};
      if (value === undefined) delete s[group][name];
      else s[group][name] = value;
    }, cx);
  }

  setBoard(key, board, cx) {
    this.draft = null;
    this.change((f) => {
      const s = ProjectsSection.scope(f, key);
      if (board === undefined) delete s.board;
      else s.board = board;
    }, cx);
  }

  // The text fields show the selected project's values.
  fill() {
    const p = this.selected ? this.projects()[this.selected] ?? {} : {};
    const w = isObject(p.worktrees) ? p.worktrees : {};
    const lin = this.linearOf(p);
    const put = (field, value) => {
      this.shown[field] = value;
      this.inputs[field].set_value(value);
    };
    put("directory", typeof w.directory === "string" ? w.directory : "");
    put("setup", typeof w.setup === "string" ? w.setup : "");
    put("vikunja", Number.isInteger(p.board?.vikunja) ? String(p.board.vikunja) : "");
    put("team", lin.team ?? "");
    put("url", lin.url ?? "");
    put("title", lin.title ?? "");
    // Herdr's own folder for the repo (settings.json worktrees.directory), for the Folder row.
    const herdr = this.host.person?.worktrees?.directory ?? "~/.herdr/worktrees";
    this.defaultDir = `${herdr}/${(this.selected ?? "").split("/").pop() || "<repo>"}`;
  }

  // A text field changed: written at once (set_value's own echo is ignored).
  typed(field, cx) {
    if (this.selected === null || this.file === null) return;
    const value = this.inputs[field].value();
    if (value === this.shown[field]) return;
    this.shown[field] = value;
    const key = this.selected;
    const text = value.trim();
    if (field === "directory" || field === "setup") return this.set(key, "worktrees", field, text || undefined, cx);
    if (field === "vikunja") {
      const id = Number(text);
      if (Number.isInteger(id) && id > 0) this.setBoard(key, { vikunja: id }, cx);
      return;
    }
    const lin = this.linearOf(this.projects()[key]);
    if (field === "team") this.setLinear({ ...lin, team: text || null }, cx);
    else if (field === "url") { if (linearUrl(lin.kind, text)) this.setLinear({ ...lin, url: text }, cx); }
    else if (field === "title") this.setLinear({ ...lin, title: text || null }, cx);
  }

  select(key, cx) {
    this.selected = key;
    this.adding = false;
    this.removing = false;
    this.draft = null;
    this.fill();
    this.lookUp(cx);
    cx.notify();
  }

  addProject(repo, cx) {
    const key = this.keyOf(repo) ?? tilde(repo);
    this.change((f) => { ProjectsSection.scope(f, key); }, cx);
    if (!(key in this.projects())) this.file.projects = { ...this.projects(), [key]: {} };
    this.select(key, cx);
  }

  // The board's tracker: "vikunja", "linear", null (none), or "?" (not understood). A draft wins.
  trackerOf(p) {
    if (this.draft?.key === this.selected) return this.draft.tracker;
    const b = p?.board;
    if (b === undefined) return null;
    const names = isObject(b) ? Object.keys(b) : [];
    if (names.length !== 1) return "?";
    if (names[0] === "vikunja") return Number.isInteger(b.vikunja) && b.vikunja > 0 ? "vikunja" : "?";
    if (names[0] === "linear") return isObject(b.linear) && this.linearOf(p, true).kind ? "linear" : "?";
    return "?";
  }

  // The Linear board as { kind, team, url, title } (null where unset), the draft over the file's.
  linearOf(p, fileOnly = false) {
    const cur = isObject(p?.board?.linear) ? p.board.linear : {};
    const kinds = KINDS.map(([k]) => k).filter((k) => cur[k] !== undefined && cur[k] !== false);
    const kind = kinds.length === 1 ? kinds[0] : null;
    const base = {
      kind,
      team: typeof cur.team === "string" ? cur.team : null,
      url: (kind === "project" || kind === "view") && typeof cur[kind] === "string" ? cur[kind] : null,
      title: typeof cur.title === "string" ? cur.title : null,
    };
    const d = !fileOnly && this.draft?.key === this.selected && this.draft.tracker === "linear" ? this.draft.linear : null;
    return d ? { ...base, ...d } : base;
  }

  // Writes a Linear board once it's complete (a cycle needs a team, a project or view its URL);
  // until then it's a draft the pickers fill in.
  setLinear(lin, cx) {
    const key = this.selected;
    const done = lin.kind === "mine" || (lin.kind === "cycle" && lin.team) || (lin.url && linearUrl(lin.kind, lin.url));
    if (!done) {
      this.draft = { key, tracker: "linear", linear: lin };
      this.lookUp(cx);
      cx.notify();
      return;
    }
    const value = {};
    if (lin.team) value.team = lin.team;
    value[lin.kind] = lin.kind === "mine" || lin.kind === "cycle" ? true : lin.url;
    if (lin.title) value.title = lin.title;
    this.setBoard(key, { linear: value }, cx);
    this.lookUp(cx);
  }

  chooseTracker(tracker, cx) {
    const p = this.projects()[this.selected];
    if (tracker === this.trackerOf(p)) return;
    if (tracker === null) this.setBoard(this.selected, undefined, cx);
    else if (tracker === "linear") this.setLinear({ kind: "mine", team: null, url: null, title: null }, cx);
    else {
      this.draft = { key: this.selected, tracker };
      this.lookUp(cx);
    }
    cx.notify();
  }

  // Fetches what the shown pickers list, once per Settings opening.
  lookUp(cx) {
    const p = this.projects()[this.selected];
    const tracker = this.selected ? this.trackerOf(p) : null;
    const fetch = (name, load) => {
      if (this.lists[name]) return;
      this.lists[name] = "loading";
      cx.spawn(async (cx) => {
        try {
          this.lists[name] = { items: await load() };
        } catch (e) {
          this.lists[name] = { error: String(e?.message ?? e) };
        }
        cx.notify();
      });
    };
    if (tracker === "vikunja") fetch("vikunja", vikunjaProjects);
    if (tracker !== "linear") return;
    fetch("teams", async () => ((await linear("list_teams", { limit: 250 })).teams ?? [])
      .map((t) => ({ value: t.key, label: t.key, detail: t.name })));
    const { kind, team } = this.linearOf(p);
    const args = team ? { team } : {};
    if (kind === "project")
      fetch(`project:${team ?? ""}`, async () => ((await linear("list_projects", { limit: 50, ...args })).projects ?? [])
        .filter((x) => linearUrl("project", x.url)).map((x) => ({ value: x.url, label: x.name })));
    if (kind === "view")
      fetch(`view:${team ?? ""}`, async () => ((await linear("list_custom_views", { limit: 100, type: "Issue", ...args })).customViews ?? [])
        .filter((x) => linearUrl("view", x.url)).map((x) => ({ value: x.url, label: x.name })));
  }

  // Pieces -----------------------------------------------------------------

  // One of a few choices, in the look of Settings' Appearance picker. value: the chosen one's key.
  segments(t, id, options, value, pick) {
    return h_flex().p(2).gap(2).rounded(8).border_1().border_color(t.border).bg(t.background).children(
      options.map(([v, label], i) =>
        div().id(`${id}-${i}`).px(10).py(4).rounded(6).text_size(13).cursor_pointer()
          .when(value === v, (el) => el.bg(t.raised).text_color(t.foreground).border_1().border_color(t.border))
          .when(value !== v, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
          .on_click((_e, cx) => pick(v, cx))
          .child(label)));
  }

  input(t, field, width) {
    const el = (field === "setup" ? Textarea : Input).new(this.inputs[field]);
    return el.when(width, (e) => e.w(width)).when(!width, (e) => e.w_full()).when(field !== "setup", (e) => e.h(32))
      .px(10).py(field === "setup" ? 6 : 0).rounded(7).border_1().border_color(this.focus === field ? t.accent : t.input)
      .bg(t.background).text_size(13).text_color(t.foreground);
  }

  // A setting whose control is too wide for the right side: title and about, then the control.
  block(t, title, about, control) {
    return v_flex().w_full().gap(8).py(12).border_b(1).border_color(t.border)
      .child(v_flex().gap(3)
        .child(div().text_size(14).text_color(t.foreground).child(title))
        .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about))))
      .child(control);
  }

  note(t, text, color) {
    return div().text_size(12.5).line_height("18px").text_color(color ?? t.dim).child(text);
  }

  waiting(t, text) {
    return h_flex().py(6).gap(8).items_center()
      .child(svg(SPINNER).size(12).text_color(t.working).spin(900))
      .child(div().text_size(12.5).text_color(t.dim).child(text));
  }

  // A list to pick one item from: items [{ value, label, detail? }].
  pickList(t, id, items, chosen, pick) {
    return v_flex().id(id).w_full().max_h(220).overflow_y_scroll().p(4).gap(1).rounded(7).border_1()
      .border_color(t.border).bg(t.background).children(
        items.map((it, i) => {
          const on = it.value === chosen;
          return h_flex().id(`${id}-${i}`).px(10).py(5).gap(10).items_center().rounded(6).cursor_pointer()
            .bg(on ? t.raised : CLEAR).hover((s) => s.bg(t.hover)).on_click((_e, cx) => pick(it.value, cx))
            .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(on ? t.foreground : t.muted).child(it.label))
            .when(Boolean(it.detail), (el) => el.child(div().text_size(12).text_color(t.dim).child(it.detail)));
        }));
  }

  // A picker's list, or why it isn't there.
  listed(t, name, render) {
    const list = this.lists[name];
    if (!list || list === "loading") return this.waiting(t, "Loading…");
    if (list.error) return this.note(t, list.error, t.blocked);
    return render(list.items);
  }

  // Sections -----------------------------------------------------------------

  projectList(t) {
    const keys = Object.keys(this.projects());
    const item = (i, key, title, about) => {
      const on = this.selected === key;
      return h_flex().id(`st-pj-p-${i}`).gap(10).px(10).py(7).items_center().rounded(7).cursor_pointer()
        .bg(on ? t.raised : CLEAR).hover((s) => s.bg(t.raised))
        .on_click((_e, cx) => this.select(key, cx))
        .child(svg("frame/settings/folder.svg").size(14).text_color(on ? t.accent : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(on ? t.foreground : t.muted).child(title))
        .when(Boolean(about), (el) => el.child(div().text_size(12).text_color(t.dim).child(about)));
    };
    const list = v_flex().w_full().gap(2)
      .child(item("defaults", "", "Defaults", "every project, unless it sets its own"))
      .children(keys.map((k, i) => item(i, k, k, k === this.here ? "this space" : "")));
    if (!this.adding)
      return list.child(h_flex().pt(8).child(this.host.button(t, "st-pj-add", "Add project", (_e, cx) => { this.adding = true; cx.notify(); })));
    const listed = new Set(keys.map(absolute));
    const repos = (this.repos ?? []).filter((r) => !listed.has(r));
    return list.child(v_flex().mt(8).p(10).gap(8).rounded(8).border_1().border_color(t.border)
      .child(this.note(t, "Add a git repo: its main checkout, so its worktrees use the same settings."))
      .when(this.repos === null, (el) => el.child(this.waiting(t, "Finding your spaces' repos…")))
      .when(this.repos !== null && !repos.length, (el) => el.child(this.note(t, "Every space's repo is already listed.")))
      .when(repos.length > 0, (el) => el.child(this.pickList(t, "st-pj-repos", repos.map((r) => ({ value: r, label: tilde(r) })), null,
        (repo, cx) => this.addProject(repo, cx))))
      .child(h_flex().gap(6)
        .child(this.host.button(t, "st-pj-choose", "Choose folder…", (_e, cx) => cx.spawn(async (cx) => {
          const folder = await pickFolder({ prompt: "Add" });
          if (!folder) return;
          const repo = await mainCheckout(folder);
          if (repo) this.addProject(repo, cx);
          else notify({ title: "Not a git repo", body: tilde(folder), level: "error" });
          cx.notify();
        })))
        .child(this.host.button(t, "st-pj-add-cancel", "Cancel", (_e, cx) => { this.adding = false; cx.notify(); }))));
  }

  // A yes/no setting: Default (what's inherited), On or Off.
  flag(t, key, scope, f) {
    const own = isObject(scope?.[f.group]) ? scope[f.group][f.name] : undefined;
    const top = isObject(this.file?.[f.group]) ? this.file[f.group][f.name] : undefined;
    const inherited = key && typeof top === "boolean" ? top : f.builtIn;
    const odd = own !== undefined && typeof own !== "boolean";
    return this.host.row(t, f.title, odd ? `${f.about} Not understood: ${JSON.stringify(own)}.` : f.about,
      this.segments(t, `st-pj-f-${f.group}-${f.name}`, [[undefined, `Default (${inherited ? "on" : "off"})`], [true, "On"], [false, "Off"]],
        own, (v, cx) => this.set(key, f.group, f.name, v, cx)));
  }

  board(t, p) {
    const tracker = this.trackerOf(p);
    const rows = [this.host.row(t, "Tracker", tracker === "?" ? `Not understood: ${JSON.stringify(p.board)}. Pick one to replace it.`
      : "The Board shows this repo's issues from it, in its spaces and their worktrees.",
      this.segments(t, "st-pj-tracker", TRACKERS, tracker, (v, cx) => this.chooseTracker(v, cx)))];
    if (tracker === "vikunja") {
      const id = Number.isInteger(p?.board?.vikunja) ? p.board.vikunja : null;
      rows.push(this.block(t, "Vikunja project", "Its first kanban view's buckets are the Board's columns.",
        this.listed(t, "vikunja", (items) => this.pickList(t, "st-pj-vk", items, id, (v, cx) => this.setBoard(this.selected, { vikunja: v }, cx)))));
      if (this.lists.vikunja?.error) rows.push(this.host.row(t, "Project id", "Type it instead.", this.input(t, "vikunja", 120)));
    }
    if (tracker === "linear") {
      const lin = this.linearOf(p);
      rows.push(this.host.row(t, "Scope", "One part of the workspace: never all of it.",
        this.segments(t, "st-pj-kind", KINDS, lin.kind, (kind, cx) =>
          this.setLinear({ ...lin, kind, url: kind === lin.kind ? lin.url : null }, cx))));
      const anyTeam = lin.kind === "cycle" ? [] : [{ value: null, label: lin.kind === "mine" ? "All teams" : "No team" }];
      const teamAbout = lin.kind === "cycle" ? "Its active cycle is the board." : lin.kind === "mine"
        ? "Your issues in this team, or in every team." : "With a team, + on the Board adds issues to it.";
      rows.push(this.block(t, "Team", teamAbout, this.listed(t, "teams", (items) =>
        this.pickList(t, "st-pj-team", [...anyTeam, ...items], lin.team, (team, cx) => this.setLinear({ ...lin, team }, cx)))));
      if (this.lists.teams?.error) rows.push(this.host.row(t, "Team key", "Type it instead.", this.input(t, "team", 120)));
      if (lin.kind === "project" || lin.kind === "view") {
        const name = `${lin.kind}:${lin.team ?? ""}`;
        const typed = this.inputs.url.value().trim();
        rows.push(this.block(t, lin.kind === "project" ? "Project" : "View", lin.team ? `In team ${lin.team}.` : "",
          v_flex().w_full().gap(8)
            .child(this.listed(t, name, (items) => items.length
              ? this.pickList(t, `st-pj-${lin.kind}`, items, lin.url, (url, cx) => this.setLinear({ ...lin, url }, cx))
              : this.note(t, `No ${lin.kind}s${lin.team ? ` in ${lin.team}` : ""}: paste one's URL.`)))
            .child(this.input(t, "url"))
            .when(Boolean(typed) && !linearUrl(lin.kind, typed), (el) => el.child(this.note(t, `Not a linear.app ${lin.kind} URL.`, t.blocked)))));
      }
      rows.push(this.host.row(t, "Title", "The Board's name for it.", this.input(t, "title", 220)));
      if (this.draft?.key === this.selected)
        rows.push(this.note(t, lin.kind === "cycle" ? "Pick a team to save it." : `Pick a ${lin.kind} to save it.`, t.working));
    }
    return rows;
  }

  render(t, cx) {
    const page = v_flex().w_full()
      .child(this.host.heading(t, "Projects"))
      .child(div().pb(8).text_size(12.5).line_height("18px").text_color(t.dim)
        .child(`Settings for each git repo, in ${tilde(appHome())}/projects.json. A repo's worktrees use them too.`));
    if (this.raw === undefined) return page.child(this.waiting(t, "Reading projects.json…"));
    if (this.error)
      return page.child(v_flex().gap(8).py(10)
        .child(this.note(t, `projects.json has an error: ${this.error}`, t.blocked))
        .child(this.note(t, "Fix it by hand: nothing is written over it until it reads again."))
        .child(h_flex().child(this.host.button(t, "st-pj-reload", "Read again", (_e, cx) => this.reload(cx)))));
    page.child(this.projectList(t));
    const key = this.selected;
    if (key === null) return page;
    const p = key ? this.projects()[key] ?? {} : null;
    const scope = key ? p : this.file;
    if (key) {
      page.child(div().h(14)).child(this.host.row(t, key, "Remove it to use the defaults again.",
        this.removing
          ? h_flex().gap(6)
            .child(this.host.button(t, "st-pj-rm-cancel", "Cancel", (_e, cx) => { this.removing = false; cx.notify(); }))
            .child(this.host.button(t, "st-pj-rm-confirm", "Remove project", (_e, cx) => {
              this.change((f) => { if (isObject(f.projects)) delete f.projects[key]; }, cx);
              this.select("", cx);
            }))
          : this.host.button(t, "st-pj-rm", "Remove project", (_e, cx) => { this.removing = true; cx.notify(); })));
    }
    page.child(div().h(14)).child(this.host.heading(t, "Worktrees"));
    if (key) {
      page.child(this.host.row(t, "Folder", `Where New worktree puts checkouts. Empty: ${this.defaultDir}.`,
        h_flex().gap(6).items_center().child(this.input(t, "directory", 240))
          .child(this.host.button(t, "st-pj-dir", "Choose…", (_e, cx) => cx.spawn(async (cx) => {
            const folder = await pickFolder({ prompt: "Choose" });
            if (!folder) return;
            this.shown.directory = tilde(folder);
            this.inputs.directory.set_value(tilde(folder));
            this.set(key, "worktrees", "directory", tilde(folder), cx);
          })))));
      page.child(this.block(t, "Setup script", "Runs with sh in each new worktree's first terminal, before any agent.", this.input(t, "setup")));
    }
    page.child(this.flag(t, key, scope, FLAGS[0]));
    page.child(div().h(14)).child(this.host.heading(t, "Claude sessions")).children(FLAGS.slice(1).map((f) => this.flag(t, key, scope, f)));
    if (key) page.child(div().h(14)).child(this.host.heading(t, "Board")).children(this.board(t, p));
    return page;
  }
}
