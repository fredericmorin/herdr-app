// The focused space's issue board, for the Board view (mods/issue-board): its repo's projects.json
// "board" (./board/config.js), a Vikunja project (./board/tracker-vikunja.js) or one Linear scope
// (./board/tracker-linear.js); a worktree space shows its repo's. Every tracker call is made here.
// Publishes shared `status.board` (the board, its columns and cards) and `status.focused` (the focused
// space's ticket, found by the label Start puts on a session's terminal), and runs what the Board asks
// through `status.requests`; the edit dialog's answers go to `status.replies`. Contract: README.md.
// Start reads the item, then opens claude-new; confirming there writes STARTED, and the card's tracker
// moves it (Vikunja: Plan or Doing; Linear: In Progress, assigned to you if nobody has it).
import { shared, setShared, layout, focused, spaces, panes, agents, terminals, openOverlay } from "herdr";
import { boardEntry } from "./board/config.js";
import { repoOfSpace, placeOf } from "./board/target.js";
import { vikunjaTracker } from "./board/tracker-vikunja.js";
import { linearTracker } from "./board/tracker-linear.js";

const REFRESH = 60_000;
// How long a rate-limited tracker's boards wait before asking again.
const PAUSE = 5 * 60_000;
// claude-new writes { plan, at, ref } here when Start is confirmed; the hub then has ref's tracker move it.
const STARTED = "issue-board.started";
const BOARD = "status.board";
const FOCUSED = "status.focused";
const REQUESTS = "status.requests";
const REPLIES = "status.replies";
// How long a reply waits for its dialog.
const KEEP_REPLY = 60_000;

function find(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A tracker without settings (Linear): no model or effort.
const settingsOf = (tracker, labels) => tracker.settings?.of(labels) ?? { model: "", effort: "" };

export class BoardHub {
  constructor(cx) {
    // The Vikunja instance: the layout's board block (board-toggle patch).
    const url = (find(layout(), "board")?.content?.props?.url ?? "https://todo.endor.one").replace(/\/+$/, "");
    this.trackers = { vikunja: vikunjaTracker({ url }), linear: linearTracker() };
    this.repo = undefined;  // the focused space's repo (its main checkout), null outside git; undefined until resolved
    this.board = null;      // the repo's board, null without one
    this.tracker = null;    // the board's tracker
    this.boards = new Map(); // key -> board, every board resolved this session: a dialog saves to its own
    this.columns = [];
    this.loading = false;
    this.again = false;     // a refresh asked for mid-load: runs once this one ends
    this.error = "";        // the board's last load or action error
    this.boardError = "";   // why projects.json's board for this repo isn't usable
    this.setup = {};        // tracker name -> true when it needs a token or a sign-in
    this.readOnly = {};     // tracker name -> true once a write was refused
    this.pausedUntil = {};  // tracker name -> when a rate-limited tracker may load again
    this.signingIn = false;
    this.syncedAt = null;
    this.watched = null;    // what the last render's watch saw
    this.taking = false;    // a timer is about to take the request queue
    this.published = { board: "", focused: "" };
    // The last confirmed start handled: the current one counts as handled, so an old start never replays.
    this.lastStarted = shared(STARTED)?.at ?? 0;
    cx.timer.every(REFRESH, (cx) => {
      this.refresh(cx);
      pruneReplies();
    });
    pruneReplies();
    this.refresh(cx);
  }

  // Writes status.board when it changed.
  publish() {
    const { board, tracker } = this;
    const text = JSON.stringify({
      key: board?.key ?? null,
      repo: this.repo,
      title: board ? tracker.titleOf(board) : null,
      openUrl: board ? tracker.openUrl(board) : null,
      tracker: tracker && { name: tracker.name, title: tracker.title, noun: tracker.noun, labelKey: tracker.labelKey,
        setup: tracker.setup, settings: tracker.settings && { models: tracker.settings.models, efforts: tracker.settings.efforts } },
      trackers: Object.values(this.trackers).map(t => ({ name: t.name, title: t.title, labelKey: t.labelKey, hint: t.hint, example: t.example })),
      columns: this.columns,
      syncedAt: this.syncedAt,
      loading: this.loading,
      error: this.error,
      boardError: this.boardError,
      setup: Boolean(tracker && this.setup[tracker.name]),
      readOnly: Boolean(tracker && this.readOnly[tracker.name]),
      signingIn: this.signingIn,
    });
    if (text === this.published.board) return;
    this.published.board = text;
    setShared(BOARD, JSON.parse(text));
  }

  // The focused space's board from projects.json: sets repo, board, tracker and boardError.
  async resolve() {
    let repo = null;
    let board = null;
    let boardError = "";
    try {
      const space = focused()?.space;
      repo = space ? repoOfSpace(space) : null;
      const entry = repo ? await boardEntry(repo, Object.keys(this.trackers)) : null;
      if (entry) {
        try {
          board = { ...this.trackers[entry.tracker].parse(entry.value, repo), claude: entry.claude };
        } catch (e) {
          throw new Error(`projects.json: ${entry.key}: board.${entry.tracker}: ${e.message}`);
        }
      }
    } catch (e) {
      boardError = e.message;
    }
    if (board?.key !== this.board?.key) {
      this.columns = [];
      this.error = "";
      this.syncedAt = null;
    }
    if (board) this.boards.set(board.key, board);
    this.repo = repo;
    this.board = board;
    this.tracker = board ? this.trackers[board.tracker] : null;
    this.boardError = boardError;
  }

  // Applies what tracker says about error e: setup, read-only, pause, the message.
  fail(tracker, e, what, write = false) {
    const p = tracker.problem(e, what, write);
    if (p.setup) this.setup[tracker.name] = true;
    if (p.readOnly) this.readOnly[tracker.name] = true;
    if (p.pause) this.pausedUntil[tracker.name] = Date.now() + PAUSE;
    // A tracker that needs setup shows its setup screen instead of a line.
    this.error = p.setup ? "" : p.message;
    this.publish();
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    this.again = false;
    this.publish();
    cx.spawn(async (cx) => {
      await this.resolve();
      const { board, tracker } = this;
      // A rate-limited tracker keeps its columns and its message until the pause is over.
      const paused = tracker && (this.pausedUntil[tracker.name] ?? 0) > Date.now();
      if (!paused) this.error = "";
      if (!board) {
        this.columns = [];
      } else if (!paused) {
        try {
          this.columns = await tracker.load(board);
          this.setup[tracker.name] = false;
          this.syncedAt = Date.now();
        } catch (e) {
          this.fail(tracker, e, "load the board");
        }
      }
      this.loading = false;
      this.publish();
      if (this.again) this.refresh(cx);
    });
  }

  // The board and tracker a request names by key, null for one never resolved here.
  named(key) {
    const board = this.boards.get(key);
    return board ? { board, tracker: this.trackers[board.tracker] } : null;
  }

  move({ key, item, column }, cx) {
    const at = this.named(key);
    if (!at) return;
    cx.spawn(async (cx) => {
      try {
        await at.tracker.move(at.board, item, column);
      } catch (e) {
        this.fail(at.tracker, e, "move it", true);
        return;
      }
      this.refresh(cx);
    });
  }

  start({ key, item, column }, cx) {
    const at = this.named(key);
    if (!at) return;
    cx.spawn(async () => {
      let p;
      try {
        p = await at.tracker.start(at.board, item, column);
      } catch (e) {
        this.fail(at.tracker, e, "read it");
        return;
      }
      openOverlay({ mod: "claude-new", kind: "dialog", width: 560, props: { ...p, started: STARTED } });
    });
  }

  // The tracker's browser sign-in (Linear), then a refresh.
  signIn({ key }, cx) {
    const at = this.named(key);
    if (this.signingIn || !at) return;
    this.signingIn = true;
    this.error = "";
    this.publish();
    cx.spawn(async (cx) => {
      try {
        await at.tracker.signIn();
        this.setup[at.tracker.name] = false;
      } catch (e) {
        this.error = `Couldn't sign in to ${at.tracker.title}: ${e.message}`;
      }
      this.signingIn = false;
      this.publish();
      this.refresh(cx);
    });
  }

  // The edit dialog's fresh copy of a task: { title, description, labels, model, effort }.
  read(id, { key, id: task }, cx) {
    const at = this.named(key);
    if (!at) return reply(id, { ok: false, error: "That board isn't loaded." });
    cx.spawn(async () => {
      try {
        const fresh = await at.tracker.read(task, at.board);
        const labels = fresh.labels ?? [];
        reply(id, { ok: true, value: { title: fresh.title ?? "", description: fresh.description ?? "", labels,
          ...settingsOf(at.tracker, labels) } });
      } catch (e) {
        reply(id, { ok: false, error: at.tracker.problem(e, "read it").message });
      }
    });
  }

  // Saves the edit dialog's form: form.id, or a new item in edit.column. On an error after a new item
  // was made, the reply carries its id so a retry edits it.
  save(id, { key, edit, form }, cx) {
    const at = this.named(key);
    if (!at) return reply(id, { ok: false, error: "That board isn't loaded." });
    let made = null;
    cx.spawn(async (cx) => {
      try {
        const full = { ...edit, ...at.tracker.editProps(at.board, edit.column) };
        await at.tracker.save(full, form, (newId) => { made = newId; });
      } catch (e) {
        reply(id, { ok: false, error: at.tracker.problem(e, "save it", true).message, id: made });
        return;
      }
      reply(id, { ok: true });
      this.refresh(cx);
    });
  }

  // Takes the request queue and runs each request.
  take(cx) {
    const queue = shared(REQUESTS) ?? [];
    setShared(REQUESTS, []);
    for (const { id, op, args } of queue) {
      if (op === "board.refresh") this.refresh(cx);
      else if (op === "board.move") this.move(args ?? {}, cx);
      else if (op === "board.start") this.start(args ?? {}, cx);
      else if (op === "board.signIn") this.signIn(args ?? {}, cx);
      else if (op === "task.read") this.read(id, args ?? {}, cx);
      else if (op === "task.save") this.save(id, args ?? {}, cx);
    }
  }

  // A start confirmed in claude-new: its tracker moves the card, once.
  started(cx) {
    const s = shared(STARTED);
    if (!s?.at || s.at <= this.lastStarted) return;
    this.lastStarted = s.at;
    const tracker = this.trackers[s.ref?.tracker];
    if (!tracker) return;
    cx.spawn(async (cx) => {
      try {
        await tracker.started(s.ref, s.plan);
      } catch (e) {
        this.fail(tracker, e, "move it", true);
        return;
      }
      this.refresh(cx);
    });
  }

  // Labels ("key=value") of terminals whose agent is working, from the label Start put on them.
  working() {
    const keys = Object.values(this.trackers).map(t => t.labelKey);
    const status = new Map(agents().map(a => [a.address, a.status]));
    const found = new Set();
    for (const term of terminals()) {
      if (status.get(term.address) !== "working") continue;
      for (const key of keys) {
        const value = term.labels?.[key];
        if (value) found.add(`${key}=${value}`);
      }
    }
    return found;
  }

  // status.focused: the focused space's place and its ticket, from the labels on the focused terminal,
  // else on an agent in the focused tab, else in the space. Only cards on the shown board count.
  focusedValue() {
    const f = focused();
    const space = spaces().find(s => s.id === f?.space);
    if (!space) return { where: null, ticket: null };
    const where = JSON.stringify([space.machine ?? null, placeOf(space, panes())]);
    const keys = Object.values(this.trackers).map(t => t.labelKey);
    const labelsOf = new Map(terminals().map(t => [t.address, t.labels ?? {}]));
    const labelOn = (address) => {
      const labels = labelsOf.get(address) ?? {};
      const key = keys.find(k => labels[k]);
      return key ? `${key}=${labels[key]}` : null;
    };
    const tabs = new Set((space.tabs ?? []).map(t => t.id));
    const inTab = agents().filter(a => a.tab === f.tab);
    const inSpace = agents().filter(a => tabs.has(a.tab));
    const labels = [labelOn(f.terminal), ...inTab.map(a => labelOn(a.address)), ...inSpace.map(a => labelOn(a.address))].filter(Boolean);
    for (const label of labels) {
      for (const column of this.columns) {
        const card = column.cards.find(c => c.label === label);
        if (card) return { where, ticket: { tracker: this.tracker.name, ref: card.ref, title: card.title, column: column.title, url: card.url } };
      }
    }
    return { where, ticket: null };
  }

  // Called from the hub's render: render can't set shared state or spawn, so timers run that after it returns.
  render(cx) {
    if (!this.taking && (shared(REQUESTS) ?? []).length > 0) {
      this.taking = true;
      cx.timer.after(0, (cx) => { this.taking = false; this.take(cx); });
    }
    const s = shared(STARTED);
    if (s?.at && s.at > this.lastStarted) cx.timer.after(0, (cx) => this.started(cx));

    // A refresh besides the timer: another space focused, its repo found (status.git), or a card's
    // session that stopped working or ended (it may have moved its card).
    const space = focused()?.space ?? null;
    const now = { space, repo: space ? repoOfSpace(space) : null, working: this.working() };
    const last = this.watched;
    this.watched = now;
    if (last) {
      const settled = [...last.working].some(label => !now.working.has(label));
      if (now.space !== last.space || now.repo !== last.repo || settled) cx.timer.after(0, (cx) => this.refresh(cx));
    }

    const focusedText = JSON.stringify(this.focusedValue());
    if (focusedText !== this.published.focused) {
      this.published.focused = focusedText;
      cx.timer.after(0, () => setShared(FOCUSED, JSON.parse(focusedText)));
    }
  }
}

// The replies still waiting for their dialog: younger than KEEP_REPLY.
function fresh(now) {
  const all = {};
  for (const [k, v] of Object.entries(shared(REPLIES) ?? {})) if (now - (v.at ?? 0) < KEEP_REPLY) all[k] = v;
  return all;
}

// Answers the edit dialog's request id.
function reply(id, value) {
  const now = Date.now();
  setShared(REPLIES, { ...fresh(now), [id]: { ...value, at: now } });
}

// Drops replies nobody took (their dialog closed or gave up), so they don't stay in shared.json.
function pruneReplies() {
  const kept = fresh(Date.now());
  if (Object.keys(kept).length !== Object.keys(shared(REPLIES) ?? {}).length) setShared(REPLIES, kept);
}
