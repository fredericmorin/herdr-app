// The Board's Vikunja side: the parent project and its sub-projects as chips, each chip's kanban view's
// buckets as columns. Same interface as ./tracker-linear.js; main.js only sees the normalized
// chips { key, tracker, title, … } (chips() gives { chips, warning? }), columns { id, title, limit, done,
// add, todo, capped, cards } and cards { id, ref, title, description, done, doneAt, due, urgency, labels,
// who, url, label }, and calls load, move, start, started, editProps, openUrl and problem.
import { mcp, setting, SETTING } from "./vikunja.js";
import { targetOf } from "./target.js";

// The terminal label Start puts on a card's session: the task id.
const TASK = "vikunja.task";
const named = (title, name) => (title ?? "").trim().toLowerCase() === name;
// New tasks start in To-Do (or another early column), never mid-work.
const NO_ADD = ["plan", "doing", "done"];
const byPosition = (a, b) => a.position - b.position;

export function vikunjaTracker({ url, root }) {
  const call = (tool, args) => mcp(url, tool, args);
  // A tool behind do_action (find_action lists them; this token sees buckets and task moves there).
  const action = (name, args) => call("do_action", { action: name, arguments: args });

  const card = (task) => ({
    id: task.id,
    ref: task.identifier || `#${task.index}`,
    title: task.title,
    description: task.description ?? "",
    done: Boolean(task.done),
    doneAt: Date.parse(task.done_at?.startsWith("0001") ? task.updated : task.done_at) || 0,
    // "0001-01-01T00:00:00Z" means no due date.
    due: !task.due_date || task.due_date.startsWith("0001") ? null : task.due_date,
    urgency: task.priority >= 4 ? 2 : task.priority >= 3 ? 1 : 0,
    labels: (task.labels ?? []).map(l => ({ id: l.id, title: l.title, color: `#${(l.hex_color || "888888").replace(/^#/, "").slice(0, 6)}` })),
    who: null,
    url: `${url}/tasks/${task.id}`,
    label: `${TASK}=${task.id}`,
  });

  return {
    name: "vikunja",
    title: "Vikunja",
    labelKey: TASK,

    async chips() {
      // The server caps pages (max_items_per_page, 50 here): read until a short page.
      const all = [];
      const fields = ["id", "title", "parent_project_id", "position", "is_archived", "views.id", "views.view_kind", "views.position"];
      for (let page = 1; ; page++) {
        const got = await call("projects_list", { page, per_page: 50, fields });
        all.push(...got.items);
        if (page >= (got.total_pages ?? 1)) break;
      }
      const kanban = (p) => (p.views ?? []).filter(v => v.view_kind === "kanban").sort(byPosition)[0]?.id;
      const list = [];
      const add = (p) => {
        if (p.is_archived || !kanban(p)) return;
        list.push({ key: `vikunja:${p.id}`, tracker: "vikunja", title: p.title, project: p.id, view: kanban(p) });
        all.filter(c => c.parent_project_id === p.id && c.id > 0).sort(byPosition).forEach(add);
      };
      const top = all.find(p => p.id === root);
      if (!top) throw new Error(`Project ${root} not found`);
      add(top);
      return { chips: list, signedIn: true };
    },

    async load(chip) {
      // Markdown descriptions: Start hands them to Claude as they are.
      const buckets = await action("project_view_buckets_tasks_list", { project: chip.project, view: chip.view, format: "markdown" });
      return (Array.isArray(buckets) ? buckets : buckets.items ?? []).sort(byPosition).map(b => ({
        id: b.id, title: b.title, limit: b.limit, capped: false,
        done: named(b.title, "done"), add: !NO_ADD.some(n => named(b.title, n)), todo: named(b.title, "to-do"),
        cards: (b.tasks ?? []).map(card),
      }));
    },

    move(chip, item, column) {
      return action("task_bucket_update", { project: chip.project, view: chip.view, bucket: column.id, task_id: item.id });
    },

    // Reads the task again so the description is current, then gives claude-new's props. Plan mode is
    // unticked when the card is already in Plan (planning done: the next start is the work); otherwise
    // claude-new picks it (projects.json's board_start.plan, else ticked).
    // The session goes to the project's repo and space (matched by name), not the focused one.
    async start(chip, item, column) {
      let fresh = { ...item, identifier: item.ref };
      try {
        fresh = await call("tasks_read", { task: item.id, format: "markdown",
          fields: ["id", "identifier", "index", "title", "description", "labels.title"] });
      } catch {}  // the card's copy is at most a minute old: good enough to start from
      // model/ and effort/ labels become claude-new's flags, not part of the message.
      const labels = (fresh.labels ?? []).map(l => l.title).filter(t => t && !SETTING.test(t));
      const lines = [`Vikunja task ${fresh.identifier || `#${fresh.index}`}: ${fresh.title}`, "",
        (fresh.description ?? "").trim(), "",
        ...(labels.length ? [`Labels: ${labels.join(", ")}`] : []), item.url, "",
        // The session moves its own card from here on (the vikunja-ticket Claude skill reads these ids).
        `Vikunja ticket: task ${item.id}, project ${chip.project}, kanban view ${chip.view}. Keep its card updated as the work progresses (vikunja-ticket skill).`];
      const target = await targetOf({ name: chip.title });
      const message = lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n").trim();
      return { ...(target ?? {}), message, ...(named(column.title, "plan") ? { plan: false } : {}), label: item.label,
        model: setting(fresh.labels, "model"), effort: setting(fresh.labels, "effort"),
        ref: { tracker: "vikunja", task: item.id, project: chip.project, view: chip.view } };
    },

    // A start confirmed in claude-new: the card goes to Plan or Doing, in the shown project's columns.
    async started(ref, plan, shown) {
      const title = plan ? "Plan" : "Doing";
      if (shown.chip?.tracker !== "vikunja" || ref?.project !== shown.chip.project) {
        throw new Error(`Couldn't move task ${ref?.task} to ${title}: its project isn't the one shown.`);
      }
      const column = shown.columns.find(c => named(c.title, title.toLowerCase()));
      if (!column) throw new Error(`No "${title}" bucket in this project's board.`);
      await this.move(shown.chip, { id: ref.task }, column);
    },

    // issue-board-edit's props for a new task in column, or for editing item.
    editProps(chip, column, item, mode) {
      return { mode, url, project: chip.project, view: chip.view,
        bucket: { id: column.id, title: column.title },
        task: item ? { id: item.id, identifier: item.ref, title: item.title, description: item.description,
          labels: item.labels.map(l => ({ id: l.id, title: l.title })) } : null };
    },

    openUrl(chip) {
      return `${url}/projects/${chip.project}/${chip.view}`;
    },

    // What an error means for the Board: setup (no token), readOnly (a write the token can't do), and a message.
    problem(e, what, write = false) {
      if (e.status === 0) return { setup: true, message: "" };
      if (write && (e.status === 401 || e.status === 403)) {
        return { readOnly: true, message: "This token can't change tasks: give it write access to tasks in Vikunja." };
      }
      return { message: e.status === undefined ? e.message : `Couldn't ${what}: ${e.message}` };
    },
  };
}
