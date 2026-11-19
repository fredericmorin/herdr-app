// Opens the focused space's worktree (the git root of the focused terminal's folder, else that
// folder, else the space's folder) in VS Code (`mod.open vscode`), then closes itself. A space on
// another machine opens over Remote-SSH, using that machine's ssh target from `hc machine ls`.
import { View, div } from "gpui-kit";
import { exec, hc, focused, spaces, props, closeOverlay, notify, checking } from "herdr";

export default class VSCode extends View {
  init(_props, cx) {
    // Read now: the popup takes the keyboard, the target is what was focused before it.
    const target = focused();
    cx.spawn(async () => {
      try {
        if (!checking()) await this.open(target);
      } catch (e) {
        notify({ title: "Couldn't open VS Code", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(props().overlay);
    });
  }

  async open(target) {
    const space = spaces().find((s) => s.id === target?.space);
    const on = space?.machine ?? null;
    const folder = target?.cwd ?? space?.folder;
    if (!folder) throw new Error("No folder for the focused space.");
    const git = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
    const root = git.code === 0 ? git.stdout.trim() : folder;
    const args = on ? ["--remote", `ssh-remote+${await this.sshTarget(on)}`, root] : [root];
    const r = await exec("code", args);
    if (r.code !== 0) throw new Error(r.stderr.trim() || `code exited with ${r.code}`);
  }

  // How herdr-core reaches the machine: an ssh host (or user@host), as VS Code's Remote-SSH takes it.
  async sshTarget(name) {
    const r = await hc(["machine", "ls"]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "hc machine ls failed");
    const machine = JSON.parse(r.stdout).machines.find((m) => m.name === name);
    if (!machine?.target) throw new Error(`No ssh target for machine ${name}.`);
    return machine.target;
  }

  render() {
    return div();
  }
}
