// Forks the focused terminal's Claude Code session, history included (`mod.open claude-fork`),
// either into a new worktree space (branch <current-branch>_fork from origin's default branch,
// made by the worktree dialog so the project's setup runs; same as the herdr-fork Claude skill)
// or into a new tab of the same space. Enter forks, Tab moves between the checkbox and the branch,
// Space flips the checkbox, Esc cancels.
// The fork runs with its source's Claude config dir: the repo's (projects.json's board.claudeConfig) when
// claude-new/claude.sh started the source, else Claude's default ~/.claude.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, home, appHome, exec, readTextFile, focused, openOverlay, run, props, closeOverlay, notify, theme, checking } from "herdr";

// projects.json's board.claudeConfig for folder's repo as a full path (claude-new/config-dir.mjs), null without one.
// Throws "projects.json: …" on an invalid file or value. Same as claude-new's.
async function configDir(folder) {
  const r = await exec("node", [`${appHome()}/mods/claude-new/config-dir.mjs`, folder]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `config-dir.mjs exited ${r.code}`);
  return r.stdout.trim() || null;
}

export default class ClaudeFork extends View {
  init(_props, cx) {
    // Read now: the dialog takes the keyboard, the target is what was focused before it.
    this.target = focused();
    this.worktree = true;
    this.handle = cx.focus_handle();
    this.branch = InputState.new({ placeholder: "Branch (optional, default <current-branch>_fork)" });
    this.branch.on("submit", (_e, cx) => this.submit(cx));
    this.at = "toggle"; // what has the keyboard, for Tab: "toggle" or "branch"
    this.branch.on("focus", (_e, cx) => { this.at = "branch"; cx.notify(); });
    this.toggleHandle = cx.focus_handle();
    this.toggleHandle.focus();
    // Refocus late in case opening took the keyboard, unless Tab has already moved on.
    cx.timer.after(600, () => { if (this.at === "toggle") this.toggleHandle.focus(); });
    // The window binds Tab to move focus across the whole window, before any on_key_down
    // sees it: bindings of our own, deeper in, come first and keep Tab in the dialog.
    cx.bind_keys([
      { keystroke: "tab", action: "claude_fork_next", context: "ClaudeFork" },
      { keystroke: "shift-tab", action: "claude_fork_prev", context: "ClaudeFork" },
    ]);
  }

  submit(cx) {
    if (checking() || this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        await this.fork(this.target);
      } catch (e) {
        notify({ title: "Couldn't fork the Claude session", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(props().overlay);
    });
  }

  async fork(target) {
    if (!target?.terminal) throw new Error("Focus the terminal running Claude Code first.");
    // Claude's session files live on this computer only.
    if (target.terminal.includes("/")) throw new Error("Only Claude sessions on this computer can be forked.");

    const got = await hc(["get", target.terminal, "--json"]);
    if (got.code !== 0) throw new Error(got.stderr.trim() || `hc get ${target.terminal} failed`);
    const pid = JSON.parse(got.stdout).foreground?.pid;

    // Claude writes <config dir>/sessions/<pid>.json with its session id and starting folder. Its config
    // dir is the repo's when claude.sh started it, else the default: --resume only finds it there.
    const own = target.cwd ? await configDir(target.cwd) : null;
    let dir = null;
    let text = null;
    for (const d of [own, `${home()}/.claude`]) {
      if (!d || !pid) continue;
      text = await readTextFile(`${d}/sessions/${pid}.json`);
      if (text) { dir = d; break; }
    }
    if (!text) throw new Error(`${target.terminal} isn't running Claude Code.`);
    const session = JSON.parse(text);
    if (!session.sessionId) throw new Error(`No session id in ${dir}/sessions/${pid}.json`);

    const folder = session.cwd ?? target.cwd;
    // claude.sh gives the fork the repo's dir again (same repo, a worktree of it included).
    const launcher = dir === own ? `${appHome()}/mods/claude-new/claude.sh` : "claude";
    const argv = [launcher, "--resume", session.sessionId, "--fork-session"];
    if (!this.worktree) {
      // --resume finds sessions by the folder Claude started in, so the fork starts there too.
      run("tab.new", { space: target.space, folder, argv });
      return;
    }
    // The worktree branches off the repo of the folder Claude started in.
    const request = { space: target.space, folder, argv };
    const branch = this.branch.value().trim();
    if (branch) request.branch = branch;
    openOverlay({ mod: "worktree-request", kind: "dialog", width: 340, props: { request } });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
    if (e.key === "enter") { this.submit(cx); cx.stop_propagation(); }
  }

  cycle(step, cx) {
    const order = this.worktree ? ["toggle", "branch"] : ["toggle"];
    this.focusAt(order[(order.indexOf(this.at) + step + order.length) % order.length], cx);
  }

  focusAt(at, cx) {
    this.at = at;
    if (at === "branch") this.branch.focus();
    else this.toggleHandle.focus();
    cx.notify();
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    // Focusable so Tab reaches it; Space flips it through on_click (GPUI clicks a focused element on Space).
    // Flipping leaves the keyboard on it, inside the dialog, so Enter still forks.
    const toggle = h_flex().id("cf-worktree").track_focus(this.toggleHandle).gap(8).items_center().cursor_pointer()
      .px(4).py(2).rounded(6).border_1().border_color(this.at === "toggle" ? t.accent : t.popover)
      .on_click((_e, cx) => {
        this.worktree = !this.worktree;
        this.focusAt("toggle", cx);
      })
      .child(h_flex().w(16).h(16).rounded(4).border_1().items_center().justify_center()
        .border_color(this.worktree ? t.accent : t.input).bg(this.worktree ? t.accent : t.background)
        .text_size(11).text_color(t.accent_foreground).child(this.worktree ? "✓" : ""))
      .child(div().text_size(12.5).child("New worktree"));
    return v_flex().id("claude-fork").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .key_context("ClaudeFork")
      .on_action("claude_fork_next", (_e, cx) => this.cycle(1, cx))
      .on_action("claude_fork_prev", (_e, cx) => this.cycle(-1, cx))
      .w_full().p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Fork Claude session"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(this.worktree ? "A new worktree of this repo, from origin's default branch" : "A new tab in this space, in the session's folder"))
      .child(toggle)
      .when(this.worktree, (el) => el.child(div().h(8)).child(Input.new(this.branch).h(36).px(10).rounded(9).border_1()
        .border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("cf-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("cf-start", this.busy ? "Forking…" : "Fork", true, (_e, cx) => this.submit(cx))));
  }
}
