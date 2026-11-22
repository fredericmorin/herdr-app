// Kanban board of a Vikunja project and its sub-projects: one chip per project, one column per
// bucket of the chip's kanban view. Cards open in the browser, move to another bucket, or start
// a Claude session (claude-new) with the ticket as its first message; confirming that dialog moves
// the card to Plan (Plan mode ticked) or Doing and switches the `center` stack back to the terminals.
// The message ends with a "Vikunja ticket:" line (task, project, view ids): the session's vikunja-ticket
// skill (~/.claude/skills) moves the card on from there, through the vikunja MCP server.
// The card's model/ and effort/ labels pick claude-new's Model and Effort (Default without them).
// "+" in a column and Edit on a card open vikunja-task, which saves and pings the board to refresh.
// Props { url, project }: the Vikunja instance and the parent project. Talks to Vikunja's own MCP
// server (<url>/api/v2/mcp) through ./vikunja.js.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, exec, openOverlay, appHome, checking, shared, layout, run, spaces, panes } from "herdr";
import { mcp, setting, SETTING } from "./vikunja.js";

const REFRESH = 60_000;
// claude-new writes { plan, at, ref } here when Start is confirmed; the board then moves ref.task.
const STARTED = "vikunja.started";
// vikunja-task writes Date.now() here after a save; the board then refreshes.
const CHANGED = "vikunja.changed";
const named = (bucket, title) => (bucket?.title ?? "").trim().toLowerCase() === title;
const COLUMN = 272;

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The repo a folder belongs to: its main checkout, and whether the folder is a linked worktree.
// null outside git. Same as Herdr's worktree dialog's repoOf (a mod can't import another's files).
async function repoOf(folder, on) {
  const git = async (args) => {
    const r = await exec("git", args, { cwd: folder, on });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim() };
  };
  const top = await git(["rev-parse", "--show-toplevel"]);
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, linked: main !== top.out };
}

// Where a Vikunja project's sessions start: the space named like it whose first terminal is in a
// repo's main checkout, as { space, folder }. Only worktree spaces of it: { folder } (its main
// checkout, no space). None: null (claude-new then uses the focused space).
async function targetOf(title) {
  const name = (title ?? "").trim().toLowerCase();
  const ps = panes();
  let fallback = null;
  for (const s of spaces()) {
    if ((s.name ?? "").trim().toLowerCase() !== name) continue;
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const at = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    const repo = at ? await repoOf(at, s.machine ?? undefined) : null;
    if (!repo) continue;
    if (!repo.linked) return { space: s.id, folder: repo.top };
    fallback ??= { folder: repo.main };
  }
  return fallback;
}

// "0001-01-01T00:00:00Z" means no due date.
function due(date) {
  if (!date || date.startsWith("0001")) return null;
  const d = new Date(date);
  return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), late: d.getTime() < Date.now() };
}

export default class VikunjaBoard extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.url = (p.url ?? "https://todo.endor.one").replace(/\/+$/, "");
    this.root = p.project ?? 15;
    this.projects = [];  // [{ id, title, view }]: the root project and its descendants, with their kanban view
    this.buckets = [];
    this.selected = Number(localStorage.getItem("project")) || this.root;
    this.loading = false;
    this.error = "";
    this.noToken = false;
    this.moving = null;  // the task whose Move row is open
    this.readOnly = false;
    // The last confirmed start handled. A copy with nothing stored takes the current one as handled,
    // so it never replays an old start.
    const stored = localStorage.getItem("started");
    this.lastStarted = stored ? Number(stored) : (shared(STARTED)?.at ?? 0);
    if (!stored) localStorage.setItem("started", String(this.lastStarted));
    this.lastChanged = shared(CHANGED) ?? 0;
    if (checking()) return;
    cx.timer.every(REFRESH, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  mcp(tool, args) {
    return mcp(this.url, tool, args);
  }

  // A tool behind do_action (find_action lists them; this token sees buckets and task moves there).
  action(name, args) {
    return this.mcp("do_action", { action: name, arguments: args });
  }

  refresh(cx) {
    // A refresh asked for mid-load (a save landed) runs again once this one ends.
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    this.again = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // The server caps pages (max_items_per_page, 50 here): read until a short page.
        const all = [];
        const fields = ["id", "title", "parent_project_id", "position", "is_archived", "views.id", "views.view_kind", "views.position"];
        for (let page = 1; ; page++) {
          const got = await this.mcp("projects_list", { page, per_page: 50, fields });
          all.push(...got.items);
          if (page >= (got.total_pages ?? 1)) break;
        }
        const kanban = (p) => (p.views ?? []).filter(v => v.view_kind === "kanban").sort((a, b) => a.position - b.position)[0]?.id;
        const byPosition = (a, b) => a.position - b.position;
        const list = [];
        const add = (p) => {
          if (p.is_archived || !kanban(p)) return;
          list.push({ id: p.id, title: p.title, view: kanban(p) });
          all.filter(c => c.parent_project_id === p.id && c.id > 0).sort(byPosition).forEach(add);
        };
        const root = all.find(p => p.id === this.root);
        if (root) add(root);
        this.projects = list;
        if (!list.some(p => p.id === this.selected)) this.selected = list[0]?.id ?? this.root;
        const project = list.find(p => p.id === this.selected);
        // Markdown descriptions: Start hands them to Claude as they are.
        const buckets = project ? await this.action("project_view_buckets_tasks_list", { project: project.id, view: project.view, format: "markdown" }) : [];
        this.buckets = (Array.isArray(buckets) ? buckets : buckets.items ?? []).sort(byPosition);
        this.error = root ? "" : `Project ${this.root} not found`;
        this.noToken = false;
      } catch (e) {
        this.noToken = e.status === 0;
        this.error = this.noToken ? "" : `Couldn't load the board: ${e.message}`;
      }
      this.loading = false;
      cx.notify();
      if (this.again) this.refresh(cx);
    });
  }

  select(id, cx) {
    this.selected = id;
    this.moving = null;
    this.buckets = [];
    localStorage.setItem("project", String(id));
    this.refresh(cx);
  }

  move(task, bucket, cx) {
    const project = this.projects.find(p => p.id === this.selected);
    this.moving = null;
    cx.spawn(async (cx) => {
      try {
        await this.action("task_bucket_update", { project: project.id, view: project.view, bucket: bucket.id, task_id: task.id });
      } catch (e) {
        if (e.status === 401 || e.status === 403) this.readOnly = true;
        this.error = this.readOnly ? "This token can't move tasks: give it write access to tasks in Vikunja." : `Couldn't move the task: ${e.message}`;
        cx.notify();
        return;
      }
      this.refresh(cx);
    });
  }

  // Reads the task again so the description is current, then opens claude-new with it. Plan mode is
  // ticked unless the card is already in Plan (planning done: the next start is the work).
  // The session goes to the project's repo and space (matched by name), not the focused one.
  start(task, bucket, cx) {
    const project = this.projects.find(p => p.id === this.selected);
    cx.spawn(async () => {
      let fresh = task;
      try {
        fresh = await this.mcp("tasks_read", { task: task.id, format: "markdown",
          fields: ["id", "identifier", "index", "title", "description", "labels.title"] });
      } catch {}  // the card's copy is at most a minute old: good enough to start from
      // model/ and effort/ labels become claude-new's flags, not part of the message.
      const labels = (fresh.labels ?? []).map(l => l.title).filter(t => t && !SETTING.test(t));
      const lines = [`Vikunja task ${fresh.identifier || `#${fresh.index}`}: ${fresh.title}`, "",
        (fresh.description ?? "").trim(), "",
        ...(labels.length ? [`Labels: ${labels.join(", ")}`] : []), `${this.url}/tasks/${task.id}`, "",
        // The session moves its own card from here on (the vikunja-ticket Claude skill reads these ids).
        `Vikunja ticket: task ${task.id}, project ${project?.id}, kanban view ${project?.view}. Keep its card updated as the work progresses (vikunja-ticket skill).`];
      const target = await targetOf(project?.title);
      const message = lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n").trim();
      openOverlay({ mod: "claude-new", kind: "dialog", width: 560, props: {
        ...(target ?? {}), message, plan: !named(bucket, "plan"), started: STARTED,
        model: setting(fresh.labels, "model"), effort: setting(fresh.labels, "effort"),
        ref: { task: task.id, project: project?.id, view: project?.view } } });
    });
  }

  // A start confirmed in claude-new: move its card to Plan or Doing, once.
  handleStarted(cx) {
    const s = shared(STARTED);
    if (!s?.at || s.at <= this.lastStarted) return;
    this.lastStarted = s.at;
    localStorage.setItem("started", String(s.at));
    // The session started from the Board (tab.new already selected its tab): show it, even if the move fails.
    if (findNode(layout(), "center")?.active === "board") run("layout.select", { stack: "center", child: "main" });
    const title = s.plan ? "Plan" : "Doing";
    if (s.ref?.project !== this.selected) {
      this.error = `Couldn't move task ${s.ref?.task} to ${title}: its project isn't the one shown.`;
      return;
    }
    const bucket = this.buckets.find(b => named(b, title.toLowerCase()));
    if (!bucket) { this.error = `No "${title}" bucket in this project's board.`; return; }
    this.move({ id: s.ref.task }, bucket, cx);
  }

  // Opens vikunja-task: a new task in bucket, or task to edit.
  editTask(mode, bucket, task) {
    const project = this.projects.find(p => p.id === this.selected);
    if (!project) return;
    openOverlay({ mod: "vikunja-task", kind: "dialog", width: 520, props: {
      mode, url: this.url, project: project.id, view: project.view,
      bucket: { id: bucket.id, title: bucket.title },
      task: task ? { id: task.id, identifier: task.identifier || `#${task.index}`, title: task.title, description: task.description ?? "",
        labels: (task.labels ?? []).map(l => ({ id: l.id, title: l.title })) } : null } });
  }

  render(cx) {
    this.handleStarted(cx);
    const changed = shared(CHANGED) ?? 0;
    if (changed > this.lastChanged) {
      this.lastChanged = changed;
      // refresh() notifies, which render can't. A spawned body still runs inside render (and its
      // throw left `loading` stuck): a timer calls it after render returns.
      cx.timer.after(0, (cx) => this.refresh(cx));
    }
    const t = theme();
    const stop = (_e, cx) => cx.stop_propagation();
    const project = this.projects.find(p => p.id === this.selected);
    const button = (id, label, action) => div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5)
      .border_1().border_color(t.border).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((e, cx) => { cx.stop_propagation(); action(e, cx); }).child(label);

    const chip = (p) => {
      const on = p.id === this.selected;
      return div().id(`chip-${p.id}`).h(26).px(10).flex().items_center().rounded(6).text_size(12.5)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.select(p.id, cx)).child(p.title);
    };

    const card = (task, bucket) => {
      const date = due(task.due_date);
      const moving = this.moving === task.id;
      return v_flex().id(`task-${task.id}`).w_full().p(10).gap(6).rounded(8).bg(t.background).border_1()
        .border_color(moving ? t.accent : t.border).hover(s => s.bg(t.hover))
        .on_click(() => exec("open", [`${this.url}/tasks/${task.id}`]))
        .child(h_flex().gap(6).items_start()
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(task.identifier || `#${task.index}`))
          .child(div().flex_1().min_w(0).text_size(13).font_medium().text_color(task.done ? t.dim : t.foreground)
            .when(task.done, el => el.line_through()).child(task.title)))
        .when((task.labels ?? []).length > 0 || date || task.priority >= 3, el => el.child(h_flex().flex_wrap().gap(4).items_center()
          .when(task.priority >= 3, el => el.child(div().text_size(11).text_color(task.priority >= 4 ? t.blocked : t.working).child(task.priority >= 4 ? "!!" : "!")))
          .children((task.labels ?? []).map(l => div().px(6).h(18).flex().items_center().rounded(4).text_size(11)
            .bg(`#${(l.hex_color || "888888").replace(/^#/, "").slice(0, 6)}33`).text_color(t.foreground).child(l.title)))
          .when(Boolean(date), el => el.child(div().text_size(11).text_color(date.late && !task.done ? t.blocked : t.dim).child(date.text)))))
        .child(h_flex().gap(4)
          .child(button(`start-${task.id}`, "Start", (_e, cx) => this.start(task, bucket, cx)))
          .when(!this.readOnly, el => el.child(button(`edit-${task.id}`, "Edit", () => this.editTask("edit", bucket, task))))
          .when(!this.readOnly && this.buckets.length > 1, el => el.child(button(`move-${task.id}`, moving ? "Cancel" : "Move", (_e, cx) => { this.moving = moving ? null : task.id; cx.notify(); }))))
        .when(moving, el => el.child(h_flex().flex_wrap().gap(4)
          .children(this.buckets.filter(b => b.id !== bucket.id).map(b => button(`to-${task.id}-${b.id}`, `→ ${b.title}`, (_e, cx) => this.move(task, b, cx))))));
    };

    const column = (bucket) => {
      const tasks = bucket.tasks ?? [];
      const count = bucket.limit > 0 ? `${tasks.length}/${bucket.limit}` : String(tasks.length);
      return v_flex().id(`bucket-${bucket.id}`).w(COLUMN).flex_none().h_full().min_h(0).gap(8)
        .child(h_flex().gap(8).items_center().px(2)
          .child(div().font_semibold().text_size(12.5).text_color(t.foreground).child(bucket.title))
          .child(div().text_size(11).text_color(bucket.limit > 0 && tasks.length > bucket.limit ? t.blocked : t.dim).child(count))
          .child(div().flex_1())
          .when(!this.readOnly, el => el.child(button(`new-${bucket.id}`, "+", () => this.editTask("new", bucket, null)))))
        .child(v_flex().id(`cards-${bucket.id}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
          .children(tasks.map(task => card(task, bucket)))
          .when(tasks.length === 0, el => el.child(div().p(10).text_size(11.5).text_color(t.dim).child("Nothing here"))));
    };

    const header = h_flex().flex_none().gap(4).px(12).py(10).items_center().border_b(1).border_color(t.border)
      .children(this.projects.map(chip))
      .child(div().flex_1())
      .when(this.loading, el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.dim).spin(900)))
      .child(button("refresh", "↻", (_e, cx) => this.refresh(cx)))
      .when(Boolean(project), el => el.child(button("open-vikunja", "Open in Vikunja", () => exec("open", [`${this.url}/projects/${project.id}/${project.view}`]))));

    let body;
    if (this.noToken) {
      body = v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
        .child(div().text_color(t.foreground).font_semibold().child("No Vikunja API token"))
        .child(div().child(`Create one in ${this.url} (Settings → API Tokens, with read and write access to projects and tasks), then save it to:`))
        .child(div().font_family("JetBrains Mono").text_color(t.foreground).child(`${appHome()}/.vikunja-token`));
    } else {
      body = h_flex().id("columns").flex_1().min_h(0).p(12).gap(12).items_start().overflow_x_scrollbar().children(this.buckets.map(column));
    }

    return v_flex().id("vikunja-board").size_full().min_h(0).bg(t.canvas).text_color(t.foreground)
      .child(header)
      .when(Boolean(this.error), el => el.child(div().px(12).py(6).text_size(12).text_color(t.blocked).child(this.error)))
      .child(body);
  }
}
