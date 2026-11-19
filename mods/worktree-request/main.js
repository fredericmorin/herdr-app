// Lets a script open the worktree dialog with props, which `herdr-app do` can't pass:
// the script writes ~/.cache/herdr/worktree-request.json, then runs
// `herdr-app do mod.open --name worktree-request`. The request is my-worktree's props
// ({ space, folder, branch, argv, tab }) plus `created` (ms); this opens my-worktree with
// them, so the project's setup runs and worktree-sync leaves the new checkout alone.
// Used by ~/.claude/skills/fanout-run-step/spawn.sh.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { home, exec, readTextFile, openOverlay, props, closeOverlay, notify, theme, checking } from "herdr";

// A request older than this was left behind by a script that gave up: ignore it.
const FRESH = 60_000;

export default class WorktreeRequest extends View {
  init(_props, cx) {
    if (checking()) return;
    cx.spawn(async () => {
      try {
        await this.open();
      } catch (e) {
        notify({ title: "Worktree request failed", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(props().overlay);
    });
  }

  async open() {
    const file = `${home()}/.cache/herdr/worktree-request.json`;
    const text = await readTextFile(file);
    if (text === null) throw new Error(`No request in ${file}.`);
    // One request, one dialog: a second mod.open must not reuse it.
    await exec("rm", ["-f", file]);
    const { created, ...request } = JSON.parse(text);
    if (!(Date.now() - created < FRESH)) throw new Error(`The request in ${file} is stale.`);
    if (!request.branch) throw new Error("The request has no branch.");
    openOverlay({ mod: "my-worktree", kind: "dialog", width: 440, height: 260, props: request });
  }

  render() {
    const t = theme();
    return v_flex().p(18).bg(t.popover).text_color(t.muted).text_size(13)
      .child(div().child("Opening worktree…"));
  }
}
