// Patcher: copies of Herdr's own mods and layouts with personal patches on top.
// Whenever this starts (Herdr replaces its originals only at start), it copies each of
// COPIES from Herdr's current original, applies every patch in PATCHES (one change each,
// possibly across several copies), checks the copies and installs the ones that changed,
// so copies follow Herdr's updates. All copies change together or not at all: if a patch
// no longer applies, the last good copies stay, ~/.config/herdr-app/patcher.error says
// why, and a toast asks for a fix. `mod.open patcher` shows the state and applies again.
// Every patch needs patches/<name>.md (what it does, what it expects from Herdr's original,
// how to check it), kept current with its patch: see README.md, which also says how to
// write and fix a patch.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, exec, readTextFile, writeTextFile, notify, props, closeOverlay, run, theme, shared, checking, updates } from "herdr";
import { ensureProjects } from "./projects.js";

// Herdr's originals that get a personal copy (a mod folder or a file), and the copy. A file
// whose copy is itself (`to` = `from`) is patched in place: see original().
const COPIES = [
  { from: "AGENTS.md", to: "AGENTS.md" },
  { from: "mods/worktree", to: "mods/my-worktree" },
  { from: "mods/menu", to: "mods/my-menu" },
  { from: "mods/new-menu", to: "mods/my-new-menu" },
  { from: "mods/spaces", to: "mods/my-spaces" },
  { from: "mods/tabs", to: "mods/my-tabs" },
  { from: "mods/agents", to: "mods/my-agents" },
  { from: "mods/toast", to: "mods/my-toast" },
  { from: "layouts/main.json", to: "layouts/my-main.json" },
];
// patches/<name>.patch, applied in this order. use-patched-copies goes first; each of the
// others is made on top of it alone, so they apply in any order and fail or get fixed alone.
const PATCHES = ["use-patched-copies", "project-worktree-settings", "open-all-worktrees", "sync-new-worktrees", "remove-locked-worktrees", "agents-md-patcher", "space-git-tail", "space-pr-status", "new-worktree-opens-claude-new", "vscode-button", "worktree-progress", "tab-history-float", "board-toggle", "keybind-float"];
const LAYOUT = "my-main";
// Herdr's version (.base) and the patched one installed (.out) of each in-place file. Hidden,
// so writing them doesn't reload the mod.
const IN_PLACE = "mods/patcher/.in-place";

const out = (r) => (r.stderr || r.stdout || "").trim();
// A patch's doc: what it does and what it expects, for whoever fixes it.
const doc = (name) => `mods/patcher/patches/${name}.md`;
// Whether a patch changes a copy, from its `+++ b/<path>` lines.
const touches = (text, c) => [...text.matchAll(/^\+\+\+ b\/(\S+)/gm)].some(([, p]) => p === c.from || p.startsWith(`${c.from}/`));
const isMod = (c) => c.from.startsWith("mods/");

// Where Herdr's original of a copy is. An in-place file is Herdr's version until the patcher
// installs over it (Herdr rewrites it at start): keep Herdr's as .base, and once it's been
// replaced by the patched .out, patch .base again rather than the already patched file.
async function original(home, c) {
  const file = `${home}/${c.from}`;
  if (c.to !== c.from) return { file };
  const base = `${home}/${IN_PLACE}/${c.from}.base`;
  const ours = await exec("cmp", ["-s", file, `${home}/${IN_PLACE}/${c.from}.out`]);
  if (ours.code === 0) return { file: base };
  const kept = await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && cp "$1" "$2"', "sh", file, base]);
  if (kept.code !== 0) return { error: out(kept) || `Couldn't keep Herdr's ${c.from}.` };
  return { file: base };
}

// Builds every copy in a temporary folder, then installs the changed ones only if
// every patch applied and every changed copy works.
async function apply() {
  const home = appHome();
  const root = (await exec("mktemp", ["-d"])).stdout.trim();
  const patches = PATCHES.map((name) => ({ name }));
  const copies = COPIES.map((c) => ({ ...c, patches: [] }));
  try {
    // Herdr's originals at their own paths under root: patches name files as a/mods/worktree/main.js.
    for (const c of copies) {
      const from = await original(home, c);
      if (from.error) {
        c.error = from.error;
        continue;
      }
      const copied = await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && cp -R "$1" "$2"', "sh", from.file, `${root}/${c.from}`]);
      if (copied.code !== 0) c.error = out(copied) || `Couldn't copy ${c.from}.`;
    }
    if (copies.some((c) => c.error)) return { patches, copies };
    for (const p of patches) {
      const file = `${home}/mods/patcher/patches/${p.name}.patch`;
      const text = await readTextFile(file);
      if (text === null) {
        p.error = `${file} is missing.`;
        continue;
      }
      for (const c of copies) if (touches(text, c)) c.patches.push(p.name);
      // Inside a git repo, git apply would skip paths it takes as outside it: stop the repo search above root.
      const applied = await exec("env", [`GIT_CEILING_DIRECTORIES=${root.replace(/\/[^/]+$/, "")}`, "git", "apply", file], { cwd: root });
      if (applied.code === 0) p.applied = true;
      else p.error = out(applied) || "git apply failed.";
    }
    if (patches.some((p) => p.error)) return { patches, copies };
    for (const c of copies) await check(home, root, c);
    if (copies.some((c) => c.error)) return { patches, copies };
    for (const c of copies.filter((c) => c.changed)) {
      const copied = !isMod(c)
        ? await exec("cp", [`${root}/${c.from}`, `${home}/${c.to}`])
        : await exec("sh", ["-c", 'mkdir -p "$2" && cp -R "$1/." "$2/"', "sh", `${root}/${c.from}`, `${home}/${c.to}`]);
      if (copied.code !== 0) {
        c.error = out(copied) || `Couldn't install ${c.to}.`;
        break;
      }
      if (c.to !== c.from) continue;
      const recorded = await exec("cp", [`${root}/${c.from}`, `${home}/${IN_PLACE}/${c.from}.out`]);
      if (recorded.code !== 0) {
        c.error = out(recorded) || `Couldn't record the patched ${c.to}.`;
        break;
      }
    }
    return { patches, copies };
  } finally {
    await exec("rm", ["-rf", root]);
  }
}

// Whether a built copy differs from the installed one and, if it does, whether it works.
async function check(home, root, c) {
  const built = `${root}/${c.from}`;
  if (isMod(c)) {
    const list = c.patches.map((p) => `- ${p}\n`).join("");
    const note = `Generated by mods/patcher at every start: ${c.from} with these patches from mods/patcher/patches/:\n${list}Edit the patches: changes here are overwritten.\n`;
    await exec("sh", ["-c", 'printf %s "$1" > "$2/GENERATED.md"', "sh", note, built]);
  }
  const same = isMod(c)
    ? await exec("diff", ["-rq", "-x", "jsconfig.json", "-x", "*.d.ts", built, `${home}/${c.to}`])
    : await exec("cmp", ["-s", built, `${home}/${c.to}`]);
  c.changed = same.code !== 0;
  if (!c.changed) return;
  if (c.from.endsWith(".json")) {
    try { JSON.parse(await readTextFile(built)); } catch (error) { c.error = `Not valid JSON: ${error}`; }
  } else if (isMod(c)) {
    const r = await exec("herdr-app", ["check", built], { timeout: 120_000 });
    if (r.code !== 0) c.error = out(r) || "herdr-app check failed.";
  }
}

async function report(patches, copies) {
  const path = `${appHome()}/patcher.error`;
  const old = await readTextFile(path);
  const problems = [
    ...patches.filter((p) => p.error).map((p) => `${p.name}.patch doesn't apply:\n${p.error}\nWhat it does and expects: ${doc(p.name)}\n`),
    ...copies.filter((c) => c.error).map((c) =>
      `${c.to} (from ${c.from}) failed:\n${c.error}\n${c.patches.map((p) => `Patched by ${p}: ${doc(p)}\n`).join("")}`),
  ];
  if (!problems.length) {
    if (old !== null) await exec("rm", ["-f", path]);
    return;
  }
  const text = `${problems.join("\n")}\nHow to fix a patch: mods/patcher/README.md\n`;
  if (text !== old) await writeTextFile(path, text, old);
}

export default class Patcher extends View {
  init(_props, cx) {
    this.overlay = props()?.overlay;
    this.patches = [];
    this.copies = [];
    this.failed = [];
    this.error = "";
    if (checking()) return;
    this.apply(cx);
    if (!this.overlay)
      cx.spawn(async () => {
        try { await ensureProjects(); } catch (error) { notify({ title: "Couldn't update projects.json", body: String(error), level: "error" }); }
      });
  }

  apply(cx) {
    if (this.running) return;
    this.running = true;
    this.patches = [];
    this.copies = [];
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { patches, copies } = await apply();
        this.patches = patches;
        this.copies = copies;
        this.failed = [...patches.filter((p) => p.error).map((p) => p.name), ...copies.filter((c) => c.error).map((c) => c.to)];
        await report(patches, copies);
        if (this.failed.length && !this.overlay)
          notify({
            title: "A Herdr patch needs fixing",
            body: `${this.failed.join(", ")} on Herdr ${updates().app.version}. Click for details.`,
            level: "error",
            action: { name: "mod.open", args: { name: "patcher" } },
          });
      } catch (error) {
        this.error = String(error);
        if (!this.overlay) notify({ title: "Patcher failed", body: this.error, level: "error" });
      }
      this.running = false;
      cx.notify();
    });
  }

  render(cx) {
    if (!this.overlay) return div();
    const t = theme();
    const button = (id, label, onClick) =>
      div().id(id).px(10).py(5).rounded(6).border(1).border_color(t.input).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
    const row = (ok, name, state, detail) =>
      v_flex().gap(2)
        .child(h_flex().gap(8)
          .child(div().w(14).text_color(ok ? t.done : t.blocked).child(ok ? "✓" : "✗"))
          .child(div().flex_1().truncate().text_color(t.foreground).child(name))
          .child(div().text_size(11).text_color(ok ? t.dim : t.blocked).child(state)))
        .when(Boolean(detail), (el) => el.child(div().pl(22).text_size(11.5).text_color(t.muted).child(detail)));
    const heading = (text) => div().pt(2).text_size(11).text_color(t.dim).child(text);
    const patchRow = (p) =>
      row(!p.error, p.name, p.error ? "doesn't apply" : p.applied ? "applied" : "not tried",
        p.error ? `${p.error}\nWhat it does and expects: ${doc(p.name)}` : "");
    const copyRow = (c) =>
      row(!c.error, c.to, c.error ? "failed" : c.changed ? "updated" : c.changed === false ? "up to date" : "not built",
        c.error ? `${c.error}\nPatched by: ${c.patches.join(", ") || "nothing"}` : "");
    return v_flex().id("patcher").size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child("Patches on Herdr's mods"))
      .child(v_flex().id("patcher-list").flex_1().min_h(0).gap(8).overflow_y_scrollbar()
        .when(this.running, (el) => el.child(div().text_color(t.muted).child("Applying…")))
        .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
        .when(this.patches.length > 0, (el) => el.child(heading("Patches")).children(this.patches.map(patchRow)))
        .when(this.copies.some((c) => c.error || c.changed !== undefined), (el) => el.child(heading("Copies")).children(this.copies.map(copyRow))))
      .when(this.failed.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted)
        .child("Nothing was changed: the last working copies stay. Fix the patch (mods/patcher/README.md says how) and it applies again.")))
      .child(h_flex().gap(8).justify_end()
        .when(!this.running && !this.failed.length && shared("layout") !== LAYOUT,
          (el) => el.child(button("switch", `Use the ${LAYOUT} layout`, () => run("layout.switch", { name: LAYOUT }))))
        .when(!this.running, (el) => el.child(button("again", "Apply again", (_e, cx) => this.apply(cx))))
        .child(button("close", "Close", () => closeOverlay(this.overlay))));
  }
}
