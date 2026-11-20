// Starts a fresh Claude Code session with a prompt as its first message (`mod.open claude-new`),
// either in a new worktree space of the focused terminal's repo (on a new branch from origin's
// default branch, made by the worktree dialog so the project's setup runs; same as the herdr-new
// Claude skill) or in a new tab of the focused space, in the focused terminal's folder.
// Props { space, folder } (New worktree in the space menu and the + menu) target that space instead of the focused one.
// The branch is required for a worktree; `claude -p` suggests one from the prompt while it's
// typed (<user>_<words_with_underscores>, user from `whoami`), until the branch is edited by hand. Enter starts, Esc cancels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { openOverlay, run, focused, props, closeOverlay, theme, exec, home, checking } from "herdr";

// How long typing pauses before the prompt is sent for a branch name.
const DEBOUNCE = 700;
// Names the deliverable, not the steps: "create new mod but investigate first" -> create_new_mod.
const NAMING = "Name a git branch after the deliverable this task asks for: what will exist or be changed when it is done. " +
  "Leave out how the work gets done (investigating, planning, testing, reviewing, asking first). " +
  "Start with the verb of the deliverable (create, add, fix, remove, rename, update...); " +
  "never with a verb for a step (investigate, explore, plan, review, check). " +
  "Example: \"create new mod but investigate first\" -> create_new_mod. " +
  "Reply with only the name: 2 to 5 lowercase words joined by underscores, at most 40 characters, no prefix, no quotes.";

// The model's reply as a slug: its last line, lowercase words joined by "_".
function toSlug(text) {
  const line = text.trim().split("\n").pop() ?? "";
  return line.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40).replace(/^_+|_+$/g, "");
}

export default class ClaudeNew extends View {
  init(_props, cx) {
    // Read now: the dialog takes the keyboard, the target is what was focused before it.
    const p = props();
    this.target = p?.space ? { space: p.space, cwd: p.folder } : focused();
    this.worktree = true;
    this.seq = 0;        // bumped on every prompt change: only the newest naming counts
    this.naming = false; // a claude -p call for the newest prompt is under way
    this.auto = "";      // the branch last filled in from the prompt
    this.typed = false;  // the branch was edited by hand: leave it alone
    this.error = "";
    this.user = "";      // `whoami`, the suggested branch's prefix
    if (!checking()) cx.spawn(async () => {
      try { this.user = (await exec("whoami", [])).stdout.trim(); } catch {}
    });
    this.input = InputState.new({ placeholder: "First message (optional)" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("change", (_e, cx) => this.promptChanged(cx));
    this.branch = InputState.new({ placeholder: "Branch (required, suggested from the message)" });
    this.branch.on("submit", (_e, cx) => this.submit(cx));
    this.branch.on("change", (_e, cx) => {
      const value = this.branch.value().trim();
      // Clearing the field hands it back to the suggestions.
      this.typed = value !== "" && value !== this.auto;
      this.error = "";
      cx.notify();
    });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
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
          const r = await exec("claude", ["-p", "--model", "haiku", "--tools", "", "--no-session-persistence",
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
    const prompt = this.input.value().trim();
    const branch = this.branch.value().trim();
    if (this.worktree && !branch) {
      // A name for this prompt is on its way: start once it's in.
      if (this.naming) { this.pending = true; cx.notify(); return; }
      this.error = "Type a branch name.";
      this.branch.focus();
      cx.notify();
      return;
    }
    closeOverlay(props().overlay);
    // `--` keeps a prompt that starts with "-" from being read as an option.
    const argv = prompt ? ["claude", "--", prompt] : ["claude"];
    if (!this.worktree) {
      run("tab.new", { space: this.target?.space, folder: this.target?.cwd, argv });
      return;
    }
    const request = { space: this.target?.space, folder: this.target?.cwd, argv, branch };
    openOverlay({ mod: "worktree-request", kind: "dialog", width: 340, props: { request } });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    const field = (state, border) => Input.new(state).h(36).px(10).rounded(9).border_1().border_color(border)
      .bg(t.background).text_size(12.8).text_color(t.foreground);
    const toggle = h_flex().id("cn-worktree").gap(8).items_center().cursor_pointer()
      .on_click((_e, cx) => { this.worktree = !this.worktree; this.error = ""; cx.notify(); })
      .child(h_flex().w(16).h(16).rounded(4).border_1().items_center().justify_center()
        .border_color(this.worktree ? t.accent : t.input).bg(this.worktree ? t.accent : t.background)
        .text_size(11).text_color(t.accent_foreground).child(this.worktree ? "✓" : ""))
      .child(div().text_size(12.5).child("New worktree"));
    const note = this.error ? [this.error, t.blocked]
      : this.naming ? ["Naming the branch from the message…", t.dim]
      : null;
    return v_flex().id("claude-new").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("New Claude session"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(this.worktree
          ? `A new worktree of ${this.target?.cwd ?? "the focused terminal's repo"}, from origin's default branch`
          : `A new tab in this space, in ${this.target?.cwd ?? "the focused terminal's folder"}`))
      .child(field(this.input, t.accent))
      .child(div().h(12))
      .child(toggle)
      .when(this.worktree, (el) => el.child(div().h(8)).child(field(this.branch, this.error ? t.blocked : t.input))
        .child(div().h(16).pt(4).text_size(11).text_color(note?.[1] ?? t.dim).child(note?.[0] ?? "")))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(button("cn-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("cn-start", this.pending ? "Waiting for branch…" : "Start", true, (_e, cx) => this.submit(cx))));
  }
}
