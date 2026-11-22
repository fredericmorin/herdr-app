// The Board's Linear side, through Linear's MCP server (./linear.js). Same interface as ./tracker-vikunja.js.
// A repo's board is one Linear scope, from its projects.json "board": { "linear": { … } }, one of:
//   { "team": "API", "mine": true }   { "team": "API", "cycle": true }   ("mine" without team: every team)
//   { "project": "https://linear.app/acme/project/payments-1a2b3c4d5e6f" }   { "view": "<view URL>", "title": "Bugs" }
// Built for a big workspace: a board is one server-side scope (never the workspace), only the shown one
// loads, each open state type is one list_issues call capped at LIMIT (a full one marks its columns
// capped: "50+" and a "More in Linear" row), and all of a refresh's calls share one helper run.
// Columns are the workflow states of the teams involved, merged by name, in Linear's type order.
import { linear, linearBatch, linearLogin, LinearError } from "./linear.js";
import { targetOf } from "./target.js";

// The terminal label Start puts on an issue's session: its identifier (ENG-123).
const ISSUE = "linear.issue";
const LIMIT = 50;
const OPEN = ["triage", "backlog", "unstarted", "started"];
// Canceled and duplicate aren't columns.
const RANK = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4 };
const KINDS = ["mine", "cycle", "project", "view"];
// list_issues' fields for cards: no description (lists cut it short; Start and Edit read the issue).
const FIELDS = ["id", "uuid", "title", "priority", "url", "gitBranchName", "updatedAt", "completedAt", "dueDate",
  "status", "statusType", "labels", "assignee", "assigneeId", "teamId"];
// How long a team's current cycle is trusted before asking again.
const CYCLE_TTL = 60 * 60_000;

// A linear.app project or view URL's 12-hex slug id, and the words before it ("payments" from payments-1a2b3c4d5e6f).
function slugOf(kind, url) {
  const m = String(url ?? "").match(new RegExp(`linear\\.app/[^/]+/${kind}/(?:([^/?#]*)-)?([0-9a-f]{12})(?:[/?#]|$)`, "i"));
  return m ? { id: m[2].toLowerCase(), words: (m[1] ?? "").replace(/-/g, " ") } : null;
}

// A repo's board from its projects.json value, or why it isn't one.
function chipOf(entry, repo) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "linear must be an object: { \"team\": \"API\", \"mine\": true }";
  const kinds = KINDS.filter(k => entry?.[k] !== undefined && entry[k] !== false);
  if (kinds.length !== 1) return "give exactly one of mine, cycle, project, view";
  const kind = kinds[0];
  const team = entry.team ?? null;
  if ((kind === "mine" || kind === "cycle") && entry[kind] !== true) return `${kind} must be true`;
  if (kind === "cycle" && !team) return "cycle needs team";
  if (team !== null && typeof team !== "string") return "team must be a team key or name";
  const slug = kind === "project" || kind === "view" ? slugOf(kind, entry[kind]) : null;
  if ((kind === "project" || kind === "view") && !slug) return `${kind} must be a linear.app ${kind} URL`;
  const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim()
    : kind === "mine" ? (team ? `${team} · mine` : "My issues")
    : kind === "cycle" ? `${team} · cycle`
    : slug.words || `${kind} ${slug.id}`;
  return { key: `linear:${repo}:${kind}:${team ?? ""}:${slug?.id ?? ""}`, tracker: "linear", title, repo, kind, team,
    slug: slug?.id ?? null, link: slug ? entry[kind] : null };
}

// A list tool's items ({issues, hasNextPage, cursor}, or a plain array) and whether more are left.
function page(value) {
  const items = Array.isArray(value) ? value : value?.issues ?? [];
  return { items, more: Boolean(value?.hasNextPage) };
}

// list_issue_statuses gives no order inside a type: keep Linear's, with review states last among the
// started ones, so a team's "first started" state is In Progress, not In Review.
const ordered = (list) => (Array.isArray(list) ? list : []).map((s, i) => ({ id: s.id, name: s.name, type: s.type,
  position: i + (s.type === "started" && /review/i.test(s.name) ? 1000 : 0) }));

const lower = (s) => String(s ?? "").trim().toLowerCase();
const nameOf = (x) => (typeof x === "string" ? x : x?.name ?? x?.displayName ?? null);

export function linearTracker() {
  const statuses = new Map();  // team (as asked: key or id) -> [{ id, name, type, position }]
  const cycles = new Map();    // team -> { id, at }: its current cycle, null without one
  let org = null;              // the workspace's URL key, from any issue's URL

  // A result's value, or throws its error.
  const value = (r) => {
    if (!r.ok) throw new LinearError(r.status, r.error);
    return r.value;
  };

  // The teams' workflow states, from the cache or one batch.
  async function statesOf(teams) {
    const missing = [...new Set(teams.filter(t => t && !statuses.has(t)))];
    if (missing.length) {
      const got = await linearBatch(missing.map(team => ({ tool: "list_issue_statuses", args: { team } })));
      missing.forEach((team, i) => statuses.set(team, ordered(value(got[i]))));
    }
    return teams.flatMap(t => statuses.get(t) ?? []);
  }

  // list_issues' scope arguments for a chip. Projects and views go by their URL (list_issues takes a
  // project's slug and a view's URL); a cycle board asks for its team's current cycle once an hour.
  async function scope(chip) {
    if (chip.kind === "mine") return { assignee: "me", ...(chip.team ? { team: chip.team } : {}) };
    if (chip.kind === "project") return { project: chip.slug };
    if (chip.kind === "view") return { customView: chip.link };
    const known = cycles.get(chip.team);
    if (!known || known.at + CYCLE_TTL < Date.now()) {
      const current = page(await linear("list_cycles", { teamId: chip.team, type: "current" })).items[0];
      cycles.set(chip.team, { id: current?.id ?? null, at: Date.now() });
    }
    const id = cycles.get(chip.team).id;
    if (!id) throw new Error(`${chip.team} has no active cycle.`);
    return { team: chip.team, cycle: id };
  }

  const card = (chip, m) => {
    // Linear's MCP calls the identifier (END-4) id, and the id uuid.
    const ref = m.id;
    const type = m.statusType ?? null;
    const priority = m.priority?.value ?? 0;
    org ??= String(m.url ?? "").match(/linear\.app\/([^/]+)\//)?.[1] ?? null;
    return {
      id: m.uuid,
      ref,
      title: m.title,
      description: m.description ?? "",
      done: type === "completed",
      doneAt: Date.parse(m.completedAt ?? m.updatedAt) || 0,
      due: m.dueDate || null,
      // Linear: 1 urgent, 2 high, 3 medium, 4 low, 0 none.
      urgency: priority === 1 ? 2 : priority === 2 ? 1 : 0,
      labels: (m.labels ?? []).map(l => ({ title: nameOf(l), color: l?.color ?? "#888888" })).filter(l => l.title),
      // Whose it is, where a board shows more than yours.
      who: chip.kind === "mine" ? null : nameOf(m.assignee),
      url: m.url,
      label: `${ISSUE}=${ref}`,
      // The team as list_issue_statuses takes it: its id, else the identifier's key (ENG).
      team: m.teamId ?? String(ref).split("-")[0],
      teamKey: String(ref).split("-")[0],
      state: m.status ?? null,
      type,
      assigned: Boolean(m.assigneeId ?? m.assignee),
      branch: m.gitBranchName ?? null,
    };
  };

  // The state of item's team that column stands for: same name, else the first of the same type.
  async function stateFor(item, column) {
    const states = await statesOf([item.team]);
    return states.find(s => lower(s.name) === column.id)
      ?? states.filter(s => s.type === column.type).sort((a, b) => a.position - b.position)[0] ?? null;
  }

  return {
    name: "linear",
    title: "Linear",
    labelKey: ISSUE,

    chipOf,

    async load(chip) {
      const args = await scope(chip);
      const types = [...OPEN, "completed"];
      const got = await linearBatch([
        ...types.map(state => ({ tool: "list_issues", args: { ...args, state, limit: LIMIT, orderBy: "updatedAt", fields: FIELDS } })),
        // The board's own team's states, even with no issues in some of them.
        ...(chip.team && !statuses.has(chip.team) ? [{ tool: "list_issue_statuses", args: { team: chip.team } }] : []),
      ]);
      if (got.length > types.length) {
        statuses.set(chip.team, ordered(value(got[types.length])));
      }
      const cards = [];
      const capped = new Set();
      types.forEach((type, i) => {
        const { items, more } = page(value(got[i]));
        if (more) capped.add(type);
        for (const m of items) cards.push(card(chip, m));
      });
      const unique = [...new Map(cards.map(c => [c.id, c])).values()];
      const states = await statesOf([chip.team, ...unique.map(c => c.team)]);
      // One column per state name, in type order, then position; issues in hidden types (canceled) drop out.
      const columns = new Map();
      for (const s of [...states].sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || a.position - b.position)) {
        if (RANK[s.type] === undefined || columns.has(lower(s.name))) continue;
        columns.set(lower(s.name), { id: lower(s.name), title: s.name, type: s.type, limit: 0, capped: capped.has(s.type),
          done: s.type === "completed", add: Boolean(chip.team) && s.type !== "started" && s.type !== "completed",
          todo: false, cards: [] });
      }
      for (const c of unique) columns.get(lower(c.state))?.cards.push(c);
      const list = [...columns.values()];
      const todo = list.find(c => c.type === "unstarted");
      if (todo) todo.todo = true;
      return list;
    },

    async move(chip, item, column) {
      const state = await stateFor(item, column);
      if (!state) throw new Error(`${item.ref}'s team has no state like ${column.title}.`);
      await linear("save_issue", { id: item.id, state: state.id });
    },

    // Reads the issue again so the description is current, then gives claude-new's props: the issue's
    // own branch name, the board's repo; model and effort are picked in the dialog.
    async start(chip, item) {
      let fresh = item;
      try { fresh = { ...item, ...card(chip, await linear("get_issue", { id: item.id })) }; } catch {}  // the card's copy will do
      const labels = fresh.labels.map(l => l.title);
      const lines = [`Linear issue ${item.ref}: ${fresh.title}`, "",
        (fresh.description ?? "").trim(), "",
        ...(labels.length ? [`Labels: ${labels.join(", ")}`] : []), item.url, "",
        // The session moves its own issue from here on (the linear-ticket Claude skill reads this line).
        `Linear ticket: issue ${item.ref}, team ${item.teamKey}. Keep its status updated as the work progresses (linear-ticket skill).`];
      const message = lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n").trim();
      const target = await targetOf(chip.repo);
      return { ...target, message, label: item.label, ...(fresh.branch ? { branch: fresh.branch } : {}),
        ref: { tracker: "linear", issue: item.id, identifier: item.ref, team: item.team, assigned: fresh.assigned } };
    },

    // A start confirmed in claude-new, Plan mode or not: the team's first started state (In Progress),
    // and you as assignee if nobody has it.
    async started(ref) {
      const started = (await statesOf([ref.team])).filter(s => s.type === "started").sort((a, b) => a.position - b.position)[0];
      if (!started) throw new Error(`${ref.identifier}'s team has no started state.`);
      await linear("save_issue", { id: ref.issue, state: started.id, ...(ref.assigned ? {} : { assignee: "me" }) });
    },

    // issue-board-edit's props for a new issue in column (the board's team, that state), or for editing item.
    editProps(chip, column, item, mode) {
      const state = (statuses.get(chip.team) ?? []).find(s => lower(s.name) === column.id);
      return { tracker: "linear", mode,
        bucket: { id: column.id, title: column.title },
        create: item ? null : { team: chip.team, ...(state ? { state: state.id } : {}),
          ...(chip.kind === "mine" ? { assignee: "me" } : {}),
          ...(chip.kind === "cycle" && cycles.get(chip.team)?.id ? { cycle: cycles.get(chip.team).id } : {}),
          ...(chip.kind === "project" ? { project: chip.slug } : {}) },
        task: item ? { id: item.id, identifier: item.ref, title: item.title, description: item.description, labels: [] } : null };
    },

    openUrl(chip) {
      if (chip.link) return chip.link;
      // The workspace's URL key comes from a loaded issue; before one, linear.app opens the last workspace.
      if (!org) return "https://linear.app";
      return chip.kind === "cycle" ? `https://linear.app/${org}/team/${chip.team}/active` : `https://linear.app/${org}/my-issues/assigned`;
    },

    // Opens the browser for Linear's sign-in and waits for it.
    signIn() {
      return linearLogin();
    },

    problem(e, what) {
      if (e.status === 0 || e.status === 401) return { setup: true, message: "" };
      if (e.status === 429) return { pause: true, message: "Linear is rate-limiting: the board waits 5 minutes before asking again." };
      return { message: e.status === undefined ? e.message : `Couldn't ${what}: ${e.message}` };
    },
  };
}
