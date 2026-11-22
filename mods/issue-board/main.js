// The focused space's issue board: its repo's projects.json "board" (./config.js), a Vikunja project
// (./tracker-vikunja.js) or one Linear scope (./tracker-linear.js); a worktree space shows its repo's.
// Going to another space shows that space's board; a repo without one says how to add it. The columns
// are the project's kanban buckets or the Linear teams' workflow states. The two trackers share one
// interface, so this file only draws columns and cards and hands actions to the board's tracker.
// Cards open in the browser, move to another column, or start a Claude session (claude-new) with the ticket
// as its first message; confirming that dialog lets the tracker move the card (Vikunja: Plan or Doing; Linear:
// In Progress, assigned to you if nobody has it) and shows the terminals again.
// The message ends with a "Vikunja ticket:" or "Linear ticket:" line: the session's vikunja-ticket or
// linear-ticket skill (~/.claude/skills) moves the card on from there.
// A Vikunja card's model/ and effort/ labels pick claude-new's Model and Effort (Default without them).
// "+" in a column that takes new items, and Edit on a card, open this mod again as a dialog (./edit.js),
// which saves through the tracker and pings the board to refresh.
// `issue-board.new` (cmd-n through the keybind mod, while the board shows) is the To-Do column's "+".
// Start labels the session's terminal (vikunja.task=<id>, linear.issue=<ID>; claude-new's label prop): while
// Claude runs there, the card shows that session's space, tab and status, a click goes to it, and Start gives
// way to a button that opens the item. A session that stops working, or ends, refreshes the board.
// A done column shows its 10 most recently done cards; a Show all toggle under them lists the rest below it.
// Props { url }: the Vikunja instance. Props { edit }: the edit dialog (./edit.js).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, nextCommand, exec, openOverlay, appHome, checking, shared, layout, run, spaces, agents, terminals, focused } from "herdr";
import { boardEntry, tilde } from "./config.js";
import { repoOfSpace } from "./target.js";
import { vikunjaTracker } from "./tracker-vikunja.js";
import { linearTracker } from "./tracker-linear.js";
import { EditDialog, CHANGED } from "./edit.js";

const REFRESH = 60_000;
// How long a rate-limited tracker's boards wait before asking again.
const PAUSE = 5 * 60_000;
// claude-new writes { plan, at, ref } here when Start is confirmed; the board then has ref's tracker move it.
const STARTED = "issue-board.started";
const COLUMN = 272;
// Done cards shown before Show all.
const RECENT = 10;

function ago(ms) {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The layout's `center` stack shows the board (board-toggle); showTerminals switches it to the tab.
const onBoard = () => findNode(layout(), "center")?.active === "board";
const showTerminals = () => { if (onBoard()) run("layout.select", { stack: "center", child: "main" }); };

function due(date) {
  if (!date) return null;
  const d = new Date(date);
  return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), late: d.getTime() < Date.now() };
}

class Board {
  init(_props, cx) {
    const p = props() ?? {};
    this.url = (p.url ?? "https://todo.endor.one").replace(/\/+$/, "");
    this.trackers = { vikunja: vikunjaTracker({ url: this.url }), linear: linearTracker() };
    this.repo = undefined;  // the focused space's repo (its main checkout), null outside git; undefined until resolved
    this.board = null;      // the repo's board, null without one
    this.tracker = null;    // the board's tracker
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
    this.handle = cx.focus_handle();
    this.moving = null;     // the card whose Move row is open
    this.showAll = false;   // a done column lists every card, not only the RECENT latest
    this.watched = null;    // what the last render's watch saw
    // The last confirmed start handled: a new copy takes the current one as handled, so it never replays an old start.
    this.lastStarted = shared(STARTED)?.at ?? 0;
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() === "new") this.newTask();
      }
    });
    cx.timer.every(REFRESH, (cx) => this.refresh(cx));
    // Redraws the "synced …s ago" label each second.
    cx.timer.every(1000, (cx) => { if (this.syncedAt) cx.notify(); });
    this.refresh(cx);
  }

  // The focused space's board from projects.json: sets repo, board, tracker and boardError.
  async resolve() {
    let repo = null;
    let board = null;
    let boardError = "";
    try {
      const space = focused()?.space;
      repo = space ? await repoOfSpace(space) : null;
      const entry = repo ? await boardEntry(repo, Object.keys(this.trackers)) : null;
      if (entry) {
        try {
          board = this.trackers[entry.tracker].parse(entry.value, repo);
        } catch (e) {
          throw new Error(`projects.json: ${entry.key}: board.${entry.tracker}: ${e.message}`);
        }
      }
    } catch (e) {
      boardError = e.message;
    }
    if (board?.key !== this.board?.key) {
      this.columns = [];
      this.moving = null;
      this.showAll = false;
      this.error = "";
      this.syncedAt = null;
    }
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
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    this.again = false;
    cx.notify();
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
      cx.notify();
      if (this.again) this.refresh(cx);
    });
  }

  move(item, column, cx) {
    const { board, tracker } = this;
    this.moving = null;
    cx.spawn(async (cx) => {
      try {
        await tracker.move(board, item, column);
      } catch (e) {
        this.fail(tracker, e, "move it", true);
        cx.notify();
        return;
      }
      this.refresh(cx);
    });
  }

  start(item, column, cx) {
    const { board, tracker } = this;
    cx.spawn(async (cx) => {
      let p;
      try {
        p = await tracker.start(board, item, column);
      } catch (e) {
        this.fail(tracker, e, "read it");
        cx.notify();
        return;
      }
      openOverlay({ mod: "claude-new", kind: "dialog", width: 560, props: { ...p, started: STARTED } });
    });
  }

  // A start confirmed in claude-new: its tracker moves the card, once.
  handleStarted(cx) {
    const s = shared(STARTED);
    if (!s?.at || s.at <= this.lastStarted) return;
    this.lastStarted = s.at;
    // The session started from the Board (tab.new already selected its tab): show it, even if the move fails.
    showTerminals();
    const tracker = this.trackers[s.ref?.tracker];
    if (!tracker) return;
    // render can't notify, and a spawned body would start inside it: a timer runs it after render returns.
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      try {
        await tracker.started(s.ref, s.plan);
      } catch (e) {
        this.fail(tracker, e, "move it", true);
        cx.notify();
        return;
      }
      this.refresh(cx);
    }));
  }

  // What a refresh waits for besides the timer: another space focused, a save in the edit dialog, a
  // card's session that stopped working or ended (it may have moved its card). One refresh for any of
  // them; a session starting work needs none.
  watch(sessions, cx) {
    const now = { space: focused()?.space ?? null, changed: shared(CHANGED) ?? 0,
      working: new Set([...sessions].filter(([, s]) => s.status === "working").map(([label]) => label)) };
    const last = this.watched;
    this.watched = now;
    if (!last) return;
    const settled = [...last.working].some(label => !now.working.has(label));
    // render can't notify, and a spawned body would start inside it: timers run these after render returns.
    if (now.space !== last.space || now.changed !== last.changed || settled) cx.timer.after(0, (cx) => this.refresh(cx));
    // Going to another space while the Board shows hands the keyboard to that space's terminal, hidden
    // behind the Board, where keys reach nothing: the Board takes it. my-tabs gives it back to the pane
    // when the terminals show again (board-toggle).
    if (now.space !== last.space && onBoard()) cx.timer.after(0, () => this.handle.focus());
  }

  // Each item's live Claude session, from the label Start put on its terminal: "key=value" ->
  // { pane, status, where }. A terminal left with only its shell (Claude exited) doesn't count.
  sessions() {
    const keys = Object.values(this.trackers).map(t => t.labelKey);
    const byAddress = new Map(agents().map(a => [a.address, a]));
    const tabs = new Map(spaces().flatMap(s => (s.tabs ?? []).map(c => [c.id, { space: s.name, tab: c.name, named: c.named }])));
    const found = new Map();
    for (const term of terminals()) {
      const agent = term.program?.agent ? byAddress.get(term.address) : null;
      if (!agent) continue;
      for (const key of keys) {
        const value = term.labels?.[key];
        const label = value && `${key}=${value}`;
        if (!label || found.has(label)) continue;
        const at = tabs.get(agent.tab);
        // An unnamed tab goes by its number: the agent's title says more, as in the tab bar.
        const tab = at?.named ? at.tab : agent.title || at?.tab || agent.tab_name;
        found.set(label, { pane: agent.pane, status: agent.status, where: `${at?.space ?? agent.space_name} › ${tab}` });
      }
    }
    return found;
  }

  // The tracker's browser sign-in (Linear), then a refresh.
  signIn(cx) {
    const tracker = this.tracker;
    if (this.signingIn || !tracker) return;
    this.signingIn = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await tracker.signIn();
        this.setup[tracker.name] = false;
      } catch (e) {
        this.error = `Couldn't sign in to ${tracker.title}: ${e.message}`;
      }
      this.signingIn = false;
      cx.notify();
      this.refresh(cx);
    });
  }

  writable() {
    const t = this.tracker;
    return Boolean(t) && !this.readOnly[t.name] && !this.setup[t.name];
  }

  // A new item in the first column that takes one (To-Do), as its "+" does.
  newTask() {
    if (!this.writable()) return;
    const column = this.columns.find(c => c.todo && c.add) ?? this.columns.find(c => c.add);
    if (column) this.editTask(column, null);
  }

  // Opens this mod again as the edit dialog (./edit.js): a new item in column, or item to edit.
  editTask(column, item) {
    const { board, tracker } = this;
    if (!board) return;
    const task = item && { id: item.id, ref: item.ref, title: item.title, description: item.description,
      labels: item.labels.map(l => ({ id: l.id, title: l.title })) };
    openOverlay({ mod: "issue-board", kind: "dialog", width: 520, props: { edit: {
      tracker: tracker.name, url: this.url, column: { id: column.id, title: column.title }, task,
      ...tracker.editProps(board, column) } } });
  }

  render(cx) {
    this.handleStarted(cx);
    const sessions = this.sessions();
    this.watch(sessions, cx);
    const t = theme();
    const stop = (_e, cx) => cx.stop_propagation();
    const { board, tracker } = this;
    const writable = this.writable();
    const button = (id, label, action) => div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5)
      .border_1().border_color(t.border).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((e, cx) => { cx.stop_propagation(); action(e, cx); }).child(label);
    const mark = (status) => status === "working"
      ? svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working).spin(900)
      : div().size(8).flex_none().rounded(4).bg(t[status] ?? t.dim);

    const card = (item, column) => {
      const date = due(item.due);
      const moving = this.moving === item.id;
      const session = sessions.get(item.label);
      const browse = () => exec("open", [item.url]);
      // Same jump as the agents list: the terminals come back if the Board is up.
      const goToSession = () => {
        showTerminals();
        run("pane.focus", { pane: session.pane });
      };
      return v_flex().id(`task-${item.id}`).w_full().p(10).gap(6).rounded(8).bg(t.background).border_1()
        .border_color(moving ? t.accent : t.border).hover(s => s.bg(t.hover))
        .on_click(() => session ? goToSession() : browse())
        .child(h_flex().gap(6).items_start()
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(item.ref))
          .child(div().flex_1().min_w(0).text_size(13).font_medium().text_color(item.done ? t.dim : t.foreground)
            .when(item.done, el => el.line_through()).child(item.title))
          // Priority, top right: !! urgent, ! high.
          .when(item.urgency > 0, el => el.child(div().flex_none().text_size(11.5).font_semibold()
            .text_color(item.urgency >= 2 ? t.blocked : t.working).child(item.urgency >= 2 ? "!!" : "!"))))
        .when(Boolean(session), el => el.child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
          .child(mark(session.status))
          .child(div().flex_1().min_w(0).truncate().child(session.where))
          .when(Boolean(session.status), el => el.child(div().flex_none()
            .text_color(session.status === "blocked" ? t.blocked : t.muted)
            .child(session.status === "blocked" ? "needs you" : session.status)))))
        .when(item.labels.length > 0 || date || Boolean(item.who), el => el.child(h_flex().flex_wrap().gap(4).items_center()
          .children(item.labels.map(l => div().px(6).h(18).flex().items_center().rounded(4).text_size(11)
            .bg(`${l.color}33`).text_color(t.foreground).child(l.title)))
          .when(Boolean(date), el => el.child(div().text_size(11).text_color(date.late && !item.done ? t.blocked : t.dim).child(date.text)))
          .when(Boolean(item.who), el => el.child(div().text_size(11).text_color(t.dim).child(item.who)))))
        .child(h_flex().gap(4)
          .child(session
            ? button(`open-${item.id}`, tracker.title, () => browse())
            : button(`start-${item.id}`, "Start", (_e, cx) => this.start(item, column, cx)))
          .when(writable, el => el.child(button(`edit-${item.id}`, "Edit", () => this.editTask(column, item))))
          .when(writable && this.columns.length > 1, el => el.child(button(`move-${item.id}`, moving ? "Cancel" : "Move", (_e, cx) => { this.moving = moving ? null : item.id; cx.notify(); }))))
        .when(moving, el => el.child(h_flex().flex_wrap().gap(4)
          .children(this.columns.filter(c => c.id !== column.id).map(c => button(`to-${item.id}-${c.id}`, `→ ${c.title}`, (_e, cx) => this.move(item, c, cx))))));
    };

    const column = (col) => {
      const cards = col.cards;
      const count = col.limit > 0 ? `${cards.length}/${col.limit}` : `${cards.length}${col.capped ? "+" : ""}`;
      const countColor = col.limit > 0 && cards.length > col.limit ? t.blocked : t.dim;
      // Done: newest done first, the RECENT latest, then the toggle, then (Show all) the rest below it.
      const sorted = col.done ? [...cards].sort((a, b) => b.doneAt - a.doneAt) : cards;
      const head = col.done ? sorted.slice(0, RECENT) : sorted;
      const rest = col.done ? sorted.slice(RECENT) : [];
      const row = (id, text, action) => div().id(id).h(28).flex_none().flex().items_center().justify_center()
        .rounded(6).text_size(11.5).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(action).child(text);
      return v_flex().id(`bucket-${col.id}`).w(COLUMN).flex_none().h_full().min_h(0).gap(8)
        .child(h_flex().gap(8).items_center().px(2)
          .child(div().font_semibold().text_size(12.5).text_color(t.foreground).child(col.title))
          .child(div().text_size(11).text_color(countColor).child(count))
          .child(div().flex_1())
          .when(writable && col.add, el => el.child(button(`new-${col.id}`, "+", () => this.editTask(col, null)))))
        .child(v_flex().id(`cards-${col.id}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
          .children(head.map(item => card(item, col)))
          .when(rest.length > 0, el => el.child(row(`more-${col.id}`, this.showAll ? "Show fewer" : `Show all (${rest.length} more)`,
            (_e, cx) => { this.showAll = !this.showAll; cx.notify(); })))
          .when(this.showAll, el => el.children(rest.map(item => card(item, col))))
          // A capped column isn't the whole list: the rest is in the tracker.
          .when(col.capped, el => el.child(row(`capped-${col.id}`, `More in ${tracker.title}`, () => exec("open", [tracker.openUrl(board)]))))
          .when(cards.length === 0, el => el.child(div().p(10).text_size(11.5).text_color(t.dim).child("Nothing here"))));
    };

    const header = h_flex().flex_none().gap(8).px(12).py(10).items_center().border_b(1).border_color(t.border)
      .child(div().h(26).flex().items_center().text_size(13).font_semibold().text_color(t.foreground)
        .child(board ? tracker.titleOf(board) : "Issue board"))
      .when(Boolean(board), el => el.child(div().text_size(11.5).text_color(t.dim).child(`${tracker.title} · ${tilde(board.repo)}`)))
      .child(div().flex_1())
      .when(this.loading, el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.dim).spin(900)))
      .when(Boolean(this.syncedAt), el => el.child(div().px(4).text_size(11).text_color(t.dim).child(`synced ${ago(this.syncedAt)}`)))
      .child(button("refresh", "↻", (_e, cx) => this.refresh(cx)))
      .when(Boolean(board), el => el.child(button("open-tracker", `Open in ${tracker.title}`, () => exec("open", [tracker.openUrl(board)]))));

    const code = (text) => div().font_family("JetBrains Mono").text_size(12).text_color(t.foreground).child(text);

    // A tracker that needs a token or a sign-in: what to do, as the tracker says.
    const setupView = (s) => v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
      .child(div().text_color(t.foreground).font_semibold().child(s.title))
      .child(div().child(s.text))
      .child(code(s.file))
      .when(Boolean(s.signIn), el => el.child(h_flex().pt(4).child(this.signingIn
        ? div().text_size(12).text_color(t.dim).child("Waiting for the sign-in in the browser…")
        : button("sign-in", s.signIn, (_e, cx) => this.signIn(cx)))));

    // A repo without a board: how to add one, for this repo, in each tracker's terms.
    const noBoard = () => {
      const key = this.repo ? tilde(this.repo) : null;
      return v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
        .child(div().text_color(t.foreground).font_semibold().child("No issue board for this project"))
        .when(!key, el => el.child(div().child("This space isn't in a git repo on this computer, so it has no board.")))
        .when(Boolean(key), el => el
          .child(div().child(`Add one under ${key} in ${tilde(appHome())}/projects.json:`))
          .children(Object.values(this.trackers).flatMap((tr, i) => [
            div().when(i > 0, d => d.pt(4)).child(`${i > 0 ? "or " : ""}${tr.hint}`),
            code(`"${key}": { "board": ${tr.example} }`)])));
    };

    let body;
    if (this.repo === undefined || this.boardError) {
      body = div();
    } else if (!board) {
      body = noBoard();
    } else if (this.setup[tracker.name]) {
      body = setupView(tracker.setup);
    } else {
      body = h_flex().id("columns").flex_1().min_h(0).p(12).gap(12).items_start().overflow_x_scrollbar().children(this.columns.map(column));
    }
    const problems = [this.boardError, this.error].filter(Boolean);

    return v_flex().id("issue-board").track_focus(this.handle).size_full().min_h(0).bg(t.canvas).text_color(t.foreground)
      .child(header)
      .children(problems.map((text, i) => div().id(`problem-${i}`).px(12).py(6).text_size(12).text_color(t.blocked).child(text)))
      .child(body);
  }
}

// A copy opened with props { edit } is the edit dialog (./edit.js); the layout's copy is the board.
// Plain classes behind this one View, so each re-renders exactly as this copy does.
export default class IssueBoard extends View {
  init(p, cx) {
    this.view = props()?.edit ? new EditDialog() : new Board();
    this.view.init(p, cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
