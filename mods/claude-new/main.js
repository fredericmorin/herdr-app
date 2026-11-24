// Starts a fresh Claude Code session with a prompt as its first message (`mod.open claude-new`),
// either in a new worktree space of the focused terminal's repo (on a new branch from origin's
// default branch, made by the worktree dialog so the project's setup runs; same as the herdr-new
// Claude skill) or in a new tab of the focused space, in the focused terminal's folder.
// Props { space, folder } (New worktree in the space menu and the + menu) target that space instead of the focused one;
// { folder } alone (the Board, when the repo's main checkout has no space) targets that folder: a worktree of it,
// or without one a new space there.
// Props { message } fill in the first message (the issue board's Start).
// The Plan mode checkbox starts Claude with `--permission-mode plan`; props { plan } tick or untick it,
// and props { worktree } the New worktree box (the Board's Fix CI: false, the session's own checkout).
// Without those props, New worktree and Plan mode start from projects.json's defaults for the
// target's repo (`board_start` for a Board start, i.e. props { ref }; `new_session` otherwise), else worktree on and
// plan on for the Board, off otherwise. A box clicked before projects.json is read keeps the click.
// The Model and Effort rows add `--model` / `--effort`; Default adds neither. Props { model, effort } pick them
// (the Board: the ticket's model/ and effort/ labels); a value not in the lists gets a chip of its own.
// Props { started, ref }: on Start (not Cancel), shared state `started` gets { plan, at, ref } so the opener can react;
// with ref (the Board) and Plan mode ticked, the message also asks Claude to ask clarifying questions first.
// Props { label: "k=v" } put that label on the session's terminal (the Board finds a card's session by it).
// The branch is required for a worktree; `claude -p` suggests one from the prompt while it's
// typed (<user>_<words_with_underscores>, user from `whoami`), until the branch is edited by hand.
// Props { branch } fill it instead, as if typed (the Board's Linear Start: the issue's own branch name).
// The message is multi-line: Enter adds a line, Cmd+Enter starts from anywhere in the dialog (Enter too, in the
// branch field), Esc cancels.
// Claude starts through ./claude.sh, which gives it the repo's Claude config dir (projects.json's
// board.claudeConfig) as CLAUDE_CONFIG_DIR; the branch naming uses the same dir (./config-dir.mjs).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { openOverlay, run, focused, props, closeOverlay, theme, exec, home, checking, setShared, spaces, appHome, readTextFile } from "herdr";

// How long typing pauses before the prompt is sent for a branch name.
const DEBOUNCE = 700;
// <core area>_<deliverable>, not the steps: "create new mod but investigate first" -> mods_create_new_mod.
const NAMING = "Name a git branch after the deliverable this task asks for: what will exist or be changed when it is done. " +
  "Shape: <core area>_<deliverable>. The core area is the one word for the part of the system it touches " +
  "(saturn, billing, auth, board...), taken from the task's own words. " +
  "Leave out how the work gets done (investigating, planning, testing, reviewing, asking first). " +
  "After the core area comes the verb of the deliverable (create, add, fix, remove, rename, update...); " +
  "never a verb for a step (investigate, explore, plan, review, check). " +
  "Examples: \"create new mod but investigate first\" -> mods_create_new_mod; " +
  "\"Introduce Saturn engine jitter for hourly job\" -> saturn_add_hourly_job_jitter. " +
  "Reply with only the name: 3 to 6 lowercase words joined by underscores, at most 40 characters, no prefix, no quotes.";

// `claude --model` aliases and `--effort` levels; "" (Default) passes no flag.
const MODELS = ["fable", "opus", "sonnet", "haiku"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const withOwn = (list, value) => (!value || list.includes(value) ? list : [...list, value]);

// Added to a Board start's message when Plan mode is ticked.
const PLAN_ASK = "Before doing this, ask important clarifying questions to understand my goals.";

// projects.json allows // and /* */ comments: blank them outside strings, keeping line numbers for errors.
// Same as the worktree dialog's (a mod can't import another's files).
const uncomment = (text) =>
  text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : m.replace(/[^\n]/g, " ")));
const absolute = (path, userHome) => (path === "~" ? userHome : path.startsWith("~/") ? `${userHome}${path.slice(1)}` : path);

// The repo's main checkout for a folder, or null outside git.
async function mainCheckout(folder, on) {
  const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  const common = (r.stdout ?? "").trim();
  if (r.code !== 0 || !common) return null;
  return common.endsWith("/.git") ? common.slice(0, -5) : common;
}

// projects.json's `<kind>` ({ worktree?, plan? }) for the repo of folder: the project's own values
// over the top-level ones. Throws "projects.json: …" on an invalid file or value.
async function claudeDefaults(kind, folder, on) {
  const raw = await readTextFile(`${appHome()}/projects.json`);
  if (raw === null) return {};
  let file;
  try { file = JSON.parse(uncomment(raw)) ?? {}; } catch (error) { throw new Error(`projects.json: ${error.message}`); }
  const main = folder ? await mainCheckout(folder, on) : null;
  const userHome = home();
  const key = main ? Object.keys(file.projects ?? {}).find((k) => absolute(k, userHome) === main) : undefined;
  const own = (key && file.projects[key]?.[kind]) || {};
  const top = file[kind] || {};
  const out = {};
  for (const name of ["worktree", "plan"]) {
    for (const [where, value] of [[key, own[name]], [null, top[name]]]) {
      if (value === undefined) continue;
      if (typeof value !== "boolean") throw new Error(`projects.json: ${where ? `${where}: ` : ""}${kind}.${name} must be true or false.`);
      out[name] ??= value;
    }
  }
  return out;
}

// projects.json's board.claudeConfig for folder's repo as a full path (./config-dir.mjs), null without one.
// Throws "projects.json: …" on an invalid file or value.
async function configDir(folder) {
  const r = await exec("node", [`${appHome()}/mods/claude-new/config-dir.mjs`, folder]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `config-dir.mjs exited ${r.code}`);
  return r.stdout.trim() || null;
}

// The model's reply as a slug: its last line, lowercase words joined by "_".
function toSlug(text) {
  const line = text.trim().split("\n").pop() ?? "";
  return line.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40).replace(/^_+|_+$/g, "");
}

export default class ClaudeNew extends View {
  init(_props, cx) {
    // Read now: the dialog takes the keyboard, the target is what was focused before it.
    const p = props();
    this.target = p?.space || p?.folder ? { space: p.space, cwd: p.folder } : focused();
    this.board = Boolean(p?.ref);
    this.worktree = typeof p?.worktree === "boolean" ? p.worktree : true;
    this.plan = typeof p?.plan === "boolean" ? p.plan : this.board;
    this.clicked = { worktree: false, plan: false }; // a box clicked by hand: projects.json no longer moves it
    this.settingsError = "";
    this.on = spaces().find((s) => s.id === this.target?.space)?.machine ?? undefined;
    // projects.json's keys are this computer's paths: another machine's space has no config dir.
    this.claudeDir = checking() || this.on || !this.target?.cwd ? Promise.resolve(null) : configDir(this.target.cwd);
    if (!checking()) cx.spawn(async (cx) => {
      try {
        // An invalid claudeConfig shows here too, before claude.sh refuses it on Start.
        const [d] = await Promise.all([claudeDefaults(this.board ? "board_start" : "new_session", this.target?.cwd, this.on), this.claudeDir]);
        if (d.worktree !== undefined && !this.clicked.worktree && typeof p?.worktree !== "boolean") this.worktree = d.worktree;
        if (d.plan !== undefined && !this.clicked.plan && typeof p?.plan !== "boolean") this.plan = d.plan;
      } catch (error) { this.settingsError = error.message; }
      cx.notify();
    });
    this.model = typeof p?.model === "string" ? p.model : "";
    this.effort = typeof p?.effort === "string" ? p.effort : "";
    this.models = withOwn(MODELS, this.model);
    this.efforts = withOwn(EFFORTS, this.effort);
    this.seq = 0;        // bumped on every prompt change: only the newest naming counts
    this.naming = false; // a claude -p call for the newest prompt is under way
    this.auto = "";      // the branch last filled in from the prompt
    this.typed = false;  // the branch was edited by hand: leave it alone
    this.error = "";
    this.user = "";      // `whoami`, the suggested branch's prefix
    if (!checking()) cx.spawn(async () => {
      try { this.user = (await exec("whoami", [])).stdout.trim(); } catch {}
    });
    this.input = TextareaState.new({ placeholder: "First message (optional)", rows: 4 });
    this.input.set_auto_grow(4, 14);
    this.at = "message"; // what has the keyboard, for Tab: "message", "toggle", "plan", "model", "effort" or "branch"
    this.input.on("focus", (_e, cx) => { this.at = "message"; cx.notify(); });
    this.input.on("change", (_e, cx) => this.promptChanged(cx));
    // The textarea's submit is Enter (a new line) or Cmd+Enter (secondary): only the latter starts.
    this.input.on("submit", (e, cx) => { if (e.secondary) this.submit(cx); });
    this.branch = InputState.new({ placeholder: "Branch (required, suggested from the message)" });
    this.branch.on("submit", (_e, cx) => this.submit(cx));
    this.branch.on("focus", (_e, cx) => { this.at = "branch"; cx.notify(); });
    this.branch.on("change", (_e, cx) => {
      const value = this.branch.value().trim();
      // Clearing the field hands it back to the suggestions.
      this.typed = value !== "" && value !== this.auto;
      this.error = "";
      cx.notify();
    });
    // Props { message } (the issue board's Start) fill the first message and suggest a branch from it.
    if (p?.message) {
      this.input.set_value(p.message);
      this.promptChanged(cx);
    }
    this.input.focus();
    // Refocus late in case opening took the keyboard, unless Tab has already moved on.
    cx.timer.after(600, () => { if (this.at === "message") this.input.focus(); });
    this.handle = cx.focus_handle();
    this.toggleHandle = cx.focus_handle();
    this.planHandle = cx.focus_handle();
    this.modelHandle = cx.focus_handle();
    this.effortHandle = cx.focus_handle();
    // The window binds Tab to move focus across the whole window, before any on_key_down
    // sees it: bindings of our own, deeper in, come first and keep Tab in the dialog.
    cx.bind_keys([
      { keystroke: "tab", action: "claude_new_next", context: "ClaudeNew" },
      { keystroke: "shift-tab", action: "claude_new_prev", context: "ClaudeNew" },
    ]);
  }

  promptChanged(cx) {
    const seq = ++this.seq;
    this.naming = false;
    this.pending = false;
    cx.notify();
    if (checking() || this.typed) return;
    cx.timer.after(DEBOUNCE, (cx) => {
      if (seq !== this.seq || this.typed) return;
      const prompt = this.input.value().trim();
      if (!prompt) return;
      this.naming = true;
      cx.notify();
      cx.spawn(async (cx) => {
        let name = "";
        try {
          const dir = await this.claudeDir;
          const r = await exec("env", [...(dir ? [`CLAUDE_CONFIG_DIR=${dir}`] : []), "claude", "-p", "--model", "haiku", "--tools", "", "--no-session-persistence",
            "--strict-mcp-config", "--setting-sources", "", "--system-prompt", NAMING, "--", prompt],
            { cwd: home(), timeout: 30_000 });
          const slug = r.code === 0 ? toSlug(r.stdout) : "";
          if (slug) name = this.user ? `${this.user}_${slug}` : slug;
        } catch {}
        if (seq !== this.seq) return;
        this.naming = false;
        if (name && !this.typed) {
          this.auto = name;
          this.branch.set_value(name);
        }
        if (this.pending) {
          this.pending = false;
          this.submit(cx);
        }
        cx.notify();
      });
    });
  }

  submit(cx) {
    let prompt = this.input.value().trim();
    const branch = this.branch.value().trim();
    if (this.worktree && !branch) {
      // A name for this prompt is on its way: start once it's in.
      if (this.naming) { this.pending = true; cx.notify(); return; }
      this.error = "Type a branch name.";
      this.branch.focus();
      cx.notify();
      return;
    }
    // Cmd+Enter can reach both a field's submit and the dialog's key handler: start once.
    if (this.closed) return;
    this.closed = true;
    const p = props();
    closeOverlay(p.overlay);
    if (p.started) setShared(p.started, { plan: this.plan, at: Date.now(), ref: p.ref });
    // A Board start in Plan mode asks before planning.
    if (p.ref && this.plan) prompt = `${prompt}\n\n${PLAN_ASK}`.trim();
    // `--` keeps a prompt that starts with "-" from being read as an option, so options go before it.
    // Another machine's space has no claude.sh (nor a projects.json of its own): plain claude there.
    const launcher = this.on ? "claude" : `${appHome()}/mods/claude-new/claude.sh`;
    const claude = [launcher, ...(this.plan ? ["--permission-mode", "plan"] : []),
      ...(this.model ? ["--model", this.model] : []), ...(this.effort ? ["--effort", this.effort] : []),
      ...(prompt ? ["--", prompt] : [])];
    // The terminal labels itself (HC_TERMINAL_ID is set in every core terminal), then becomes Claude.
    const argv = p.label
      ? ["sh", "-c", 'hc label "$HC_TERMINAL_ID" "$1" >/dev/null; shift; exec "$@"', "sh", p.label, ...claude]
      : claude;
    if (!this.worktree) {
      if (!this.target?.space && this.target?.cwd) run("space.new", { folder: this.target.cwd, argv });
      else run("tab.new", { space: this.target?.space, folder: this.target?.cwd, argv });
      return;
    }
    const request = { space: this.target?.space, folder: this.target?.cwd, argv, branch };
    openOverlay({ mod: "worktree-request", kind: "dialog", width: 340, props: { request } });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
    else if (e.keystroke === "cmd-enter") { this.submit(cx); cx.stop_propagation(); }
  }

  cycle(step, cx) {
    const order = ["message", "toggle", "plan", "model", "effort", ...(this.worktree ? ["branch"] : [])];
    this.focusAt(order[(order.indexOf(this.at) + step + order.length) % order.length], cx);
  }

  focusAt(at, cx) {
    this.at = at;
    if (at === "message") this.input.focus();
    else if (at === "branch") this.branch.focus();
    else if (at === "plan") this.planHandle.focus();
    else if (at === "model") this.modelHandle.focus();
    else if (at === "effort") this.effortHandle.focus();
    else this.toggleHandle.focus();
    cx.notify();
  }

  toggleWorktree(cx) {
    this.worktree = !this.worktree;
    this.clicked.worktree = true;
    this.error = "";
    cx.notify();
  }

  togglePlan(cx) {
    this.plan = !this.plan;
    this.clicked.plan = true;
    cx.notify();
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    const field = (el, border) => el.px(10).rounded(9).border_1().border_color(border)
      .bg(t.background).text_size(12.8).text_color(t.foreground);
    // Focusable so Tab reaches it; Space flips it through on_click (GPUI clicks a focused element on Space).
    // The ring shows it has the keyboard.
    const checkbox = (id, handle, at, on, label, action) => h_flex().id(id).track_focus(handle).gap(8).items_center()
      .cursor_pointer().px(4).py(2).rounded(6).border_1().border_color(this.at === at ? t.accent : t.popover)
      .on_click(action)
      .child(h_flex().w(16).h(16).rounded(4).border_1().items_center().justify_center()
        .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
        .text_size(11).text_color(t.accent_foreground).child(on ? "✓" : ""))
      .child(div().text_size(12.5).child(label));
    const toggles = h_flex().gap(12)
      .child(checkbox("cn-worktree", this.toggleHandle, "toggle", this.worktree, "New worktree", (_e, cx) => this.toggleWorktree(cx)))
      .child(checkbox("cn-plan", this.planHandle, "plan", this.plan, "Plan mode", (_e, cx) => this.togglePlan(cx)));
    // Chips with Default ("") first. Focusable so Tab reaches the row; ←/→ move the choice there.
    const choice = (id, handle, at, label, values, current, set) => {
      const all = ["", ...values];
      return h_flex().id(id).track_focus(handle).gap(4).items_center().px(4).py(2).rounded(6)
        .border_1().border_color(this.at === at ? t.accent : t.popover)
        .on_key_down((e, cx) => {
          const step = e.key === "right" ? 1 : e.key === "left" ? -1 : 0;
          if (!step) return;
          set(all[(all.indexOf(current) + step + all.length) % all.length]);
          cx.stop_propagation();
          cx.notify();
        })
        .child(div().w(48).text_size(12.5).text_color(t.muted).child(label))
        .children(all.map((v) => h_flex().id(`${id}-${v || "default"}`).h(24).px(9).items_center().rounded(6)
          .border_1().border_color(v === current ? t.accent : t.input).bg(v === current ? t.accent : t.background)
          .text_size(12).text_color(v === current ? t.accent_foreground : t.foreground).cursor_pointer()
          .on_click((_e, cx) => { set(v); this.focusAt(at, cx); }).child(v || "Default")));
    };
    const settings = v_flex().gap(4)
      .child(choice("cn-model", this.modelHandle, "model", "Model", this.models, this.model, (v) => { this.model = v; }))
      .child(choice("cn-effort", this.effortHandle, "effort", "Effort", this.efforts, this.effort, (v) => { this.effort = v; }));
    const note = this.error ? [this.error, t.blocked]
      : this.naming ? ["Naming the branch from the message…", t.dim]
      : null;
    return v_flex().id("claude-new").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .key_context("ClaudeNew")
      .on_action("claude_new_next", (_e, cx) => this.cycle(1, cx))
      .on_action("claude_new_prev", (_e, cx) => this.cycle(-1, cx))
      .w_full().p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("New Claude session"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(this.worktree
          ? `A new worktree of ${this.target?.cwd ?? "the focused terminal's repo"}, from origin's default branch`
          : `A new tab in this space, in ${this.target?.cwd ?? "the focused terminal's folder"}`))
      .when(Boolean(this.settingsError), (el) => el.child(div().pb(10).text_size(11).text_color(t.blocked).child(this.settingsError)))
      .child(field(Textarea.new(this.input).py(8), t.accent))
      .child(div().h(12))
      .child(toggles)
      .child(div().h(8))
      .child(settings)
      .when(this.worktree, (el) => el.child(div().h(8)).child(field(Input.new(this.branch).h(36), this.error ? t.blocked : t.input))
        .child(div().h(16).pt(4).text_size(11).text_color(note?.[1] ?? t.dim).child(note?.[0] ?? "")))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(button("cn-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("cn-start", this.pending ? "Waiting for branch…" : "Start", true, (_e, cx) => this.submit(cx))));
  }
}
