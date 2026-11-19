// Forks the focused terminal's Claude Code session, history included, into a new tab of
// the same space (`mod.open claude-fork`). Same as the herdr-fork Claude skill.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { hc, home, readTextFile, focused, run, props, closeOverlay, notify, theme, checking } from "herdr";

export default class ClaudeFork extends View {
  init(_props, cx) {
    if (checking()) return;
    const target = focused();
    cx.spawn(async (cx) => {
      try {
        await this.fork(target);
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

    // Claude writes ~/.claude/sessions/<pid>.json with its session id and starting folder.
    const text = pid ? await readTextFile(`${home()}/.claude/sessions/${pid}.json`) : null;
    if (!text) throw new Error(`${target.terminal} isn't running Claude Code.`);
    const session = JSON.parse(text);
    if (!session.sessionId) throw new Error(`No session id in ~/.claude/sessions/${pid}.json`);

    // --resume finds sessions by the folder Claude started in, so the fork starts there too.
    run("tab.new", {
      space: target.space,
      folder: session.cwd ?? target.cwd,
      argv: ["claude", "--resume", session.sessionId, "--fork-session"],
    });
  }

  render() {
    const t = theme();
    return v_flex().p(18).bg(t.popover).text_color(t.muted).text_size(13)
      .child(div().child("Forking Claude session…"));
  }
}
