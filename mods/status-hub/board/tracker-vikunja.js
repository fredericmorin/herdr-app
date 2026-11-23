// The Board's Vikunja side: a repo's board is one Vikunja project (projects.json: "board": { "vikunja": 16 }),
// its first kanban view's buckets as columns. Same interface as ./tracker-linear.js; ../board.js only sees
// the board { key, tracker, repo, … } (parse), columns { id, title, limit, done, add, todo, capped, cards }
// and cards { id, ref, title, description, done, doneAt, due, urgency, labels, who, url, label, model, effort }.
import { mcp, setting, SETTING, MODELS, EFFORTS, addCommand } from "./vikunja.js";
import { targetOf, ticketMessage } from "./target.js";

// The terminal label Start puts on a card's session: the task id.
const TASK = "vikunja.task";
const named = (title, name) => (title ?? "").trim().toLowerCase() === name;
// New tasks start in To-Do (or another early column), never mid-work.
const NO_ADD = ["plan", "doing", "done"];
const byPosition = (a, b) => a.position - b.position;

export function vikunjaTracker({ url }) {
  const call = (tool, args) => mcp(url, tool, args);
  // A tool behind do_action (find_action lists them; this token sees buckets and task moves there).
  const action = (name, args) => call("do_action", { action: name, arguments: args });
  const projects = new Map();  // project id -> { title, view }: its first kanban view

  async function project(id) {
    if (!projects.has(id)) {
      const p = await call("projects_read", { id, fields: ["id", "title", "views.id", "views.view_kind", "views.position"] });
      const kanban = (p.views ?? []).filter(v => v.view_kind === "kanban").sort(byPosition)[0];
      if (!kanban) throw new Error(`Vikunja project ${id} (${p.title}) has no kanban view.`);
      projects.set(id, { title: p.title, view: kanban.id });
    }
    return projects.get(id);
  }

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
    model: setting(task.labels, "model"),
    effort: setting(task.labels, "effort"),
  });

  return {
    name: "vikunja",
    title: "Vikunja",
    noun: "task",
    labelKey: TASK,
    // The board's "no board for this repo" hint.
    hint: "a Vikunja project, by its id:",
    example: `{ "vikunja": 16 }`,
    setup: {
      title: "Vikunja isn't in Claude Code",
      steps: [
        { text: "The Board calls Vikunja's MCP server with the token Claude Code has for it. Create an API token in Vikunja (Settings → API Tokens, read and write access to projects and tasks):", copy: url },
        { text: "then add the server to Claude Code, with the token in place of <token>:", copy: addCommand(url) },
      ],
    },
    // The edit dialog's Model and Effort rows: the task's model/ and effort/ labels, which Start
    // hands to claude-new.
    settings: {
      models: MODELS,
      efforts: EFFORTS,
      of: (labels) => ({ model: setting(labels, "model"), effort: setting(labels, "effort") }),
    },

    // A repo's board from its projects.json value (a project id). Throws why it isn't one.
    parse(value, repo) {
      if (!Number.isInteger(value) || value <= 0) throw new Error("vikunja must be a Vikunja project id (a number)");
      return { key: `vikunja:${value}:${repo}`, tracker: "vikunja", project: value, repo };
    },

    // The project's title comes with the first load.
    titleOf(board) {
      return projects.get(board.project)?.title ?? `Vikunja project ${board.project}`;
    },

    async load(board) {
      const { view } = await project(board.project);
      // Markdown descriptions: Start hands them to Claude as they are.
      const buckets = await action("project_view_buckets_tasks_list", { project: board.project, view, format: "markdown" });
      return (Array.isArray(buckets) ? buckets : buckets.items ?? []).sort(byPosition).map(b => ({
        id: b.id, title: b.title, limit: b.limit, capped: false,
        done: named(b.title, "done"), add: !NO_ADD.some(n => named(b.title, n)), todo: named(b.title, "to-do"),
        cards: (b.tasks ?? []).map(card),
      }));
    },

    async move(board, item, column) {
      const { view } = await project(board.project);
      return action("task_bucket_update", { project: board.project, view, bucket: column.id, task_id: item.id });
    },

    // Reads the task again so the description is current, then gives claude-new's props. Plan mode is
    // unticked when the card is already in Plan (planning done: the next start is the work); otherwise
    // claude-new picks it (projects.json's board_start.plan, else ticked).
    // The session goes to the repo's main checkout and its space.
    async start(board, item, column) {
      const { view } = await project(board.project);
      let fresh = { ...item, identifier: item.ref };
      try {
        fresh = await call("tasks_read", { task: item.id, format: "markdown",
          fields: ["id", "identifier", "index", "title", "description", "labels.title"] });
      } catch {}  // the card's copy is at most a minute old: good enough to start from
      // model/ and effort/ labels become claude-new's flags, not part of the message.
      const labels = (fresh.labels ?? []).map(l => l.title).filter(t => t && !SETTING.test(t));
      const message = ticketMessage({
        heading: `Vikunja task ${fresh.identifier || `#${fresh.index}`}: ${fresh.title}`,
        description: fresh.description, labels, url: item.url,
        // The session moves its own card from here on (the vikunja-ticket Claude skill reads these ids).
        ticket: `Vikunja ticket: task ${item.id}, project ${board.project}, kanban view ${view}. Keep its card updated as the work progresses (vikunja-ticket skill).`,
      });
      const target = await targetOf(board.repo);
      return { ...target, message, ...(named(column.title, "plan") ? { plan: false } : {}), label: item.label,
        model: setting(fresh.labels, "model"), effort: setting(fresh.labels, "effort"),
        ref: { tracker: "vikunja", task: item.id, project: board.project, view } };
    },

    // A start confirmed in claude-new: the card goes to Plan or Doing.
    async started(ref, plan) {
      const title = plan ? "Plan" : "Doing";
      // The ref's own project and view: the space shown can change while the session starts.
      const got = await action("buckets_list", { project: ref.project, view: ref.view });
      const bucket = (Array.isArray(got) ? got : got.items ?? []).find(b => named(b.title, title.toLowerCase()));
      if (!bucket) throw new Error(`No "${title}" bucket in Vikunja project ${ref.project}'s board.`);
      await action("task_bucket_update", { project: ref.project, view: ref.view, bucket: bucket.id, task_id: ref.task });
    },

    // The edit dialog's own props: where a new task goes.
    editProps(board) {
      return { project: board.project };
    },

    // The edit dialog's fresh copy of a task: { title, description, labels }.
    read(id) {
      return call("tasks_read", { task: id, format: "markdown", fields: ["title", "description", "labels.id", "labels.title"] });
    },

    // Saves the edit dialog: task id, or a new task in edit.column (created(id) right after it's made,
    // so a retry after a later error edits it). Model and effort replace the task's model/ and effort/
    // labels, which must already exist in Vikunja (this token can't create labels); labels: the
    // task's as last read.
    async save(edit, { id, labels, title, description, model, effort }, created) {
      const wanted = [["model", model], ["effort", effort]];
      const relabel = wanted.some(([kind, value]) => value !== setting(labels, kind));
      // Labels are looked up first: a missing one stops the save before anything is written.
      const chosen = [];
      for (const [kind, value] of relabel ? wanted : []) {
        if (!value) continue;
        const name = `${kind}/${value}`;
        const found = await call("labels_list", { q: name, fields: ["id", "title"] });
        const label = (found.items ?? []).find(l => l.title === name);
        if (!label) throw new Error(`No "${name}" label in Vikunja: create it there first.`);
        chosen.push(label);
      }
      if (id) {
        await call("tasks_update", { task: id, title, description, format: "markdown" });
      } else {
        id = (await call("tasks_create", { project: edit.project, title, description, bucket_id: edit.column.id, format: "markdown" })).id;
        labels = [];
        created(id);
      }
      if (relabel) {
        const kept = [...labels.filter(l => !SETTING.test(l.title ?? "")), ...chosen].map(l => ({ id: l.id, title: l.title }));
        await action("task_labels_bulk_replace", { task: id, labels: kept });
      }
    },

    openUrl(board) {
      // Before the first load, the project's default view.
      const view = projects.get(board.project)?.view;
      return `${url}/projects/${board.project}${view ? `/${view}` : ""}`;
    },

    // What an error means for the Board: setup (no token), readOnly (a write the token can't do), and a message.
    problem(e, what, write = false) {
      if (e.status === 0) return { setup: true, message: e.message };
      if (write && (e.status === 401 || e.status === 403)) {
        return { readOnly: true, message: "This token can't change tasks: give it write access to tasks in Vikunja." };
      }
      return { message: e.status === undefined ? e.message : `Couldn't ${what}: ${e.message}` };
    },
  };
}
