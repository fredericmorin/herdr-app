// Keybind: keys whose action depends on what the window shows. `keybind.<name>` in keys.json runs
// the first rule of <name> in ./binds.json whose `if` holds:
//   { "new": [ { "if": { "shown": "board" }, "do": "vikunja-board.new" }, { "do": "space.new" } ] }
// `if.shown`: a layout node id that's on screen (not hidden, and the active child of every stack
// above it). No `if`: always. `do`: a keys.json-style action, "name", "name:value" (the value
// fills the command's first argument) or { "command", "args" }; "<mod>.<command>" works too; a list
// of actions runs each in turn.
// Draws nothing: it floats in my-main (patcher's keybind-float) so it's always loaded.

import { View, div } from "gpui-kit";
import { layout, run, commands, focused, spaces, nextCommand, readTextFile, notify, appHome, checking } from "herdr";

const BINDS = "mods/keybind/binds.json";

// Whether node `id` is on screen under `node`: null when it isn't under it at all.
function shown(node, id) {
  if (!node) return null;
  if (node.id === id) return !node.hidden;
  for (const child of node.children ?? []) {
    const found = shown(child, id);
    if (found === null) continue;
    const active = node.type !== "stack" || (node.active ?? node.children[0]?.id) === child.id;
    return found && active && !node.hidden;
  }
  return null;
}

function holds(cond) {
  if (!cond) return true;
  if (cond.shown != null && !shown(layout(), cond.shown)) return false;
  return true;
}

// A keys.json-style action as [command, args].
function parse(action) {
  if (typeof action === "object" && action) return [action.command, action.args ?? {}];
  const at = action.indexOf(":");
  if (at < 0) return [action, {}];
  const name = action.slice(0, at);
  const first = commands().find((c) => c.name === name)?.args[0]?.name;
  return [name, first ? { [first]: action.slice(at + 1) } : {}];
}

export default class Keybind extends View {
  init(_props, cx) {
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        const name = await nextCommand();
        // Read on every press: binds.json edits apply at once and errors show when they matter.
        let rules;
        try {
          rules = JSON.parse(await readTextFile(`${appHome()}/${BINDS}`) ?? "{}")[name];
        } catch (e) {
          notify({ title: "Keybind", body: `${BINDS}: ${e.message}`, level: "error" });
          continue;
        }
        const rule = (rules ?? []).find((r) => holds(r.if));
        if (!rule) continue;
        for (const action of Array.isArray(rule.do) ? rule.do : [rule.do]) {
          const [command, args] = parse(action);
          // A mod's run() makes spaces on this computer; a key makes them on the focused space's machine.
          if (command === "space.new" && !("machine" in args)) {
            args.machine = spaces().find((s) => s.id === focused()?.space)?.machine ?? "";
          }
          run(command, args);
        }
      }
    });
  }

  render() {
    return div();
  }
}
