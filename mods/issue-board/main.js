// The focused space's issue board: its repo's projects.json "board" (./config.js), a Vikunja project
// (./tracker-vikunja.js) or one Linear scope (./tracker-linear.js); a worktree space shows its repo's.
// Going to another space shows that space's board; a repo without one says how to add it. The columns
// are the project's kanban buckets or the Linear teams' workflow states. The two trackers share one
// interface, so this file only draws columns and cards and hands actions to the board's tracker.
// Cards open in the browser, move to another column, or start a Claude session (claude-new) with the ticket
// as its first message; confirming that dialog lets the tracker move the card (Vikunja: Plan or Doing; Linear:
// In Progress, assigned to you if nobody has it) and switches the `center` stack back to the terminals.
// The message ends with a "Vikunja ticket:" or "Linear ticket:" line: the session's vikunja-ticket or
// linear-ticket skill (~/.claude/skills) moves the card on from there.
// A Vikunja card's model/ and effort/ labels pick claude-new's Model and Effort (Default without them).
// "+" in a column that takes new items, and Edit on a card, open issue-board-edit, which saves and pings the board to refresh.
// `issue-board.new` (cmd-n through the keybind mod, while the board shows) is the To-Do column's "+".
// Start labels the session's terminal (vikunja.task=<id>, linear.issue=<ID>; claude-new's label prop): while
// Claude runs there, the card shows that session's space, tab and status, a click goes to it, and Start gives
// way to a button that opens the item. A change in those sessions' statuses refreshes the board.
// A done column shows its 10 most recently done cards; a Show all toggle under them lists the rest below it.
// Props { url }: the Vikunja instance.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, nextCommand, exec, openOverlay, appHome, checking, shared, layout, run, spaces, agents, terminals, focused } from "herdr";
import { repoOfSpace, boardOf, tilde } from "./config.js";
import { vikunjaTracker } from "./tracker-vikunja.js";
import { linearTracker } from "./tracker-linear.js";

const REFRESH = 60_000;
// How long a rate-limited tracker's boards wait before asking again.
const PAUSE = 5 * 60_000;
// claude-new writes { plan, at, ref } here when Start is confirmed; the board then has ref's tracker move it.
const STARTED = "issue-board.started";
// issue-board-edit writes Date.now() here after a save; the board then refreshes.
const CHANGED = "issue-board.changed";
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

function due(date) {
  if (!date) return null;
  const d = new Date(date);
  return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), late: d.getTime() < Date.now() };
}

export default class IssueBoard extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const url = (p.url ?? "https://todo.endor.one").replace(/\/+$/, "");
    this.vikunjaUrl = url;
    this.trackers = { vikunja: vikunjaTracker({ url }), linear: linearTracker() };
    this.board = null;     // the focused space's board (a tracker's chip), null without one
    this.missing = null;   // without one: { repo } (the repo's main checkout, null outside git)
    this.spaceId = null;   // the space the board was resolved for
    this.columns = [];
    this.loading = false;
    this.error = "";       // the board's last load or action error
    this.boardError = "";  // why projects.json's board for this repo isn't usable
    this.setup = {};       // tracker name -> true when it needs a token or a sign-in
    this.readOnly = {};    // tracker name -> true once a write was refused
    this.pausedUntil = {}; // tracker name -> when a rate-limited tracker may load again
    this.signingIn = false;
    this.handle = cx.focus_handle();
    this.moving = null;  // the card whose Move row is open
    this.showAll = false;  // a done column lists every card, not only the RECENT latest
    // The last confirmed start handled. A copy with nothing stored takes the current one as handled,
    // so it never replays an old start.
    const started = localStorage.getItem("started");
    this.lastStarted = started ? Number(started) : (shared(STARTED)?.at ?? 0);
    if (!started) localStorage.setItem("started", String(this.lastStarted));
    this.lastChanged = shared(CHANGED) ?? 0;
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

  chip() {
    return this.board;
  }

  tracker(chip) {
    return chip ? this.trackers[chip.tracker] : null;
  }

  // The focused space's board from projects.json: sets board, missing and boardError.
  async resolve() {
    const spaceId = focused()?.space ?? null;
    let board = null;
    let missing = null;
    this.boardError = "";
    try {
      // Other machines' repos aren't keys in projects.json.
      const repo = spaceId ? await repoOfSpace(spaceId) : null;
      const entry = repo && !repo.machine ? await boardOf(repo.main) : null;
      if (!entry) {
        missing = { repo: repo && !repo.machine ? repo.main : null };
      } else {
        const chip = this.trackers[entry.tracker].chipOf(entry.value, repo.main);
        if (typeof chip === "string") this.boardError = `projects.json: ${entry.key}: board.${entry.tracker}: ${chip}`;
        // The same board keeps what its loads learned (a Vikunja project's title and view).
        else board = chip.key === this.board?.key ? this.board : chip;
      }
    } catch (e) {
      this.boardError = e.message;
    }
    if (board?.key !== this.board?.key) {
      this.columns = [];
      this.moving = null;
      this.showAll = false;
      this.error = "";
      this.syncedAt = null;
    }
    this.board = board;
    this.missing = missing;
    this.spaceId = spaceId;
  }

  // Applies what tracker says about error e: setup, read-only, the message.
  fail(tracker, e, what, write = false) {
    const p = tracker.problem(e, what, write);
    if (p.setup) this.setup[tracker.name] = true;
    if (p.readOnly) this.readOnly[tracker.name] = true;
    if (p.pause) this.pausedUntil[tracker.name] = Date.now() + PAUSE;
    this.error = p.message;
  }

  refresh(cx) {
    // A refresh asked for mid-load (a save landed) runs again once this one ends.
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    this.again = false;
    cx.notify();
    cx.spawn(async (cx) => {
      await this.resolve();
      const chip = this.chip();
      const tracker = this.tracker(chip);
      // A rate-limited tracker keeps its columns and its message until the pause is over.
      const paused = tracker && (this.pausedUntil[tracker.name] ?? 0) > Date.now();
      if (!paused) this.error = "";
      if (chip && !paused) {
        try {
          this.columns = await tracker.load(chip);
          this.setup[tracker.name] = false;
          this.syncedAt = Date.now();
        } catch (e) {
          this.fail(tracker, e, "load the board");
        }
      } else if (!chip) {
        this.columns = [];
      }
      this.loading = false;
      cx.notify();
      if (this.again) this.refresh(cx);
    });
  }

  move(item, column, cx) {
    const chip = this.chip();
    const tracker = this.tracker(chip);
    this.moving = null;
    cx.spawn(async (cx) => {
      try {
        await tracker.move(chip, item, column);
      } catch (e) {
        this.fail(tracker, e, "move it", true);
        cx.notify();
        return;
      }
      this.refresh(cx);
    });
  }

  start(item, column, cx) {
    const chip = this.chip();
    const tracker = this.tracker(chip);
    cx.spawn(async (cx) => {
      let p;
      try {
        p = await tracker.start(chip, item, column);
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
    localStorage.setItem("started", String(s.at));
    // The session started from the Board (tab.new already selected its tab): show it, even if the move fails.
    if (findNode(layout(), "center")?.active === "board") run("layout.select", { stack: "center", child: "main" });
    // Starts from before Linear boards have no tracker in their ref.
    const tracker = this.trackers[s.ref?.tracker ?? "vikunja"];
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

  // A tracker's browser sign-in (Linear), then a refresh.
  signIn(tracker, cx) {
    if (this.signingIn) return;
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

  writable(tracker) {
    return tracker && !this.readOnly[tracker.name] && !this.setup[tracker.name];
  }

  // A new item in the first column that takes one (To-Do), as its "+" does.
  newTask() {
    if (!this.writable(this.tracker(this.chip()))) return;
    const column = this.columns.find(c => c.todo && c.add) ?? this.columns.find(c => c.add);
    if (column) this.editTask("new", column, null);
  }

  // Opens issue-board-edit: a new item in column, or item to edit.
  editTask(mode, column, item) {
    const chip = this.chip();
    const tracker = this.tracker(chip);
    if (!chip) return;
    openOverlay({ mod: "issue-board-edit", kind: "dialog", width: 520, props: tracker.editProps(chip, column, item, mode) });
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
    // Another space focused: show its board.
    const spaceNow = focused()?.space ?? null;
    if (!this.loading && !checking() && spaceNow !== this.spaceId) cx.timer.after(0, (cx) => this.refresh(cx));
    // Going to another space while the Board shows hands the keyboard to that space's terminal, hidden
    // behind the Board, where keys reach nothing: the Board takes it. my-tabs gives it back to the pane
    // when the terminals show again (board-toggle).
    if (findNode(layout(), "center")?.active === "board" && this.keySpace !== undefined && spaceNow !== this.keySpace && !checking()) {
      cx.timer.after(0, () => this.handle.focus());
    }
    this.keySpace = spaceNow;
    const t = theme();
    const stop = (_e, cx) => cx.stop_propagation();
    const chip = this.chip();
    const tracker = this.tracker(chip);
    const writable = this.writable(tracker);
    const button = (id, label, action) => div().id(id).h(22).px(8).flex().items_center().rounded(5).text_size(11.5)
      .border_1().border_color(t.border).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((e, cx) => { cx.stop_propagation(); action(e, cx); }).child(label);

    const sessions = this.sessions();
    // A card's session changing status (or starting, or ending) is when it likely moved its card: reload then, not at the next minute.
    const sessionState = [...sessions].map(([id, s]) => `${id}:${s.status}`).sort().join(",");
    if (this.sessionState !== undefined && sessionState !== this.sessionState && !checking()) {
      cx.timer.after(0, (cx) => this.refresh(cx));
    }
    this.sessionState = sessionState;
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
        if (findNode(layout(), "center")?.active === "board") run("layout.select", { stack: "center", child: "main" });
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
          .when(writable, el => el.child(button(`edit-${item.id}`, "Edit", () => this.editTask("edit", column, item))))
          .when(writable && this.columns.length > 1, el => el.child(button(`move-${item.id}`, moving ? "Cancel" : "Move", (_e, cx) => { this.moving = moving ? null : item.id; cx.notify(); }))))
        .when(moving, el => el.child(h_flex().flex_wrap().gap(4)
          .children(this.columns.filter(c => c.id !== column.id).map(c => button(`to-${item.id}-${c.id}`, `→ ${c.title}`, (_e, cx) => this.move(item, c, cx))))));
    };

    const column = (col) => {
      const cards = col.cards;
      const count = col.limit > 0 ? `${cards.length}/${col.limit}` : `${cards.length}${col.capped ? "+" : ""}`;
      const countColor = col.limit > 0 && cards.length > col.limit ? t.blocked : t.dim;
      // Done: newest done first, the RECENT latest, then the toggle, then (Show all) the rest below it.
      let shown = cards;
      let hidden = 0;
      if (col.done) {
        shown = [...cards].sort((a, b) => b.doneAt - a.doneAt);
        hidden = Math.max(0, shown.length - RECENT);
        if (!this.showAll) shown = shown.slice(0, RECENT);
      }
      const row = (id, text, action) => div().id(id).h(28).flex_none().flex().items_center().justify_center()
        .rounded(6).text_size(11.5).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(action).child(text);
      return v_flex().id(`bucket-${col.id}`).w(COLUMN).flex_none().h_full().min_h(0).gap(8)
        .child(h_flex().gap(8).items_center().px(2)
          .child(div().font_semibold().text_size(12.5).text_color(t.foreground).child(col.title))
          .child(div().text_size(11).text_color(countColor).child(count))
          .child(div().flex_1())
          .when(writable && col.add, el => el.child(button(`new-${col.id}`, "+", () => this.editTask("new", col, null)))))
        .child(v_flex().id(`cards-${col.id}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
          .children(shown.slice(0, RECENT).map(item => card(item, col)))
          .when(hidden > 0, el => el.child(row(`more-${col.id}`, this.showAll ? "Show fewer" : `Show all (${hidden} more)`,
            (_e, cx) => { this.showAll = !this.showAll; cx.notify(); })))
          .children(shown.slice(RECENT).map(item => card(item, col)))
          // A capped column isn't the whole list: the rest is in the tracker.
          .when(col.capped, el => el.child(row(`capped-${col.id}`, `More in ${tracker.title}`, () => exec("open", [tracker.openUrl(chip)]))))
          .when(cards.length === 0, el => el.child(div().p(10).text_size(11.5).text_color(t.dim).child("Nothing here"))));
    };

    // A Vikunja project's title comes with its first load.
    const title = chip ? (chip.title ?? `Vikunja project ${chip.project}`) : "Issue board";
    const header = h_flex().flex_none().gap(8).px(12).py(10).items_center().border_b(1).border_color(t.border)
      .child(div().h(26).flex().items_center().text_size(13).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(chip), el => el.child(div().text_size(11.5).text_color(t.dim).child(`${tracker.title} · ${tilde(chip.repo)}`)))
      .child(div().flex_1())
      .when(this.loading, el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.dim).spin(900)))
      .when(Boolean(this.syncedAt), el => el.child(div().px(4).text_size(11).text_color(t.dim).child(`synced ${ago(this.syncedAt)}`)))
      .child(button("refresh", "↻", (_e, cx) => this.refresh(cx)))
      .when(Boolean(chip), el => el.child(button("open-tracker", `Open in ${tracker.title}`, () => exec("open", [tracker.openUrl(chip)]))));

    const vikunjaSetup = () => v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
      .child(div().text_color(t.foreground).font_semibold().child("No Vikunja API token"))
      .child(div().child(`Create one in ${this.vikunjaUrl} (Settings → API Tokens, with read and write access to projects and tasks), then save it to:`))
      .child(div().font_family("JetBrains Mono").text_color(t.foreground).child(`${appHome()}/.vikunja-token`));

    const linearSetup = () => v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
      .child(div().text_color(t.foreground).font_semibold().child("Not signed in to Linear"))
      .child(div().child("The Board reads Linear through Linear's MCP server. Sign in once in the browser; the token stays in:"))
      .child(div().font_family("JetBrains Mono").text_color(t.foreground).child(`${appHome()}/.linear-mcp.json`))
      .child(h_flex().pt(4).child(this.signingIn
        ? div().text_size(12).text_color(t.dim).child("Waiting for the sign-in in the browser…")
        : button("linear-sign-in", "Sign in to Linear", (_e, cx) => this.signIn(tracker, cx))));

    // A repo without a board: how to add one, for this repo.
    const noBoard = () => {
      const key = this.missing?.repo ? tilde(this.missing.repo) : null;
      const code = (text) => div().font_family("JetBrains Mono").text_size(12).text_color(t.foreground).child(text);
      return v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
        .child(div().text_color(t.foreground).font_semibold().child("No issue board for this project"))
        .when(!key, el => el.child(div().child("This space isn't in a git repo on this computer, so it has no board.")))
        .when(Boolean(key), el => el
          .child(div().child(`Add one under ${key} in ${tilde(appHome())}/projects.json: a Vikunja project, by its id,`))
          .child(code(`"${key}": { "board": { "vikunja": 16 } }`))
          .child(div().pt(4).child("or one Linear scope: \"mine\": true (with or without a team), \"cycle\": true with a team, or a \"project\" or \"view\" URL."))
          .child(code(`"${key}": { "board": { "linear": { "team": "ENG", "mine": true } } }`)));
    };

    let body;
    if (this.boardError || (!chip && !this.missing)) {
      body = div();
    } else if (!chip) {
      body = noBoard();
    } else if (this.setup[tracker.name]) {
      body = tracker.name === "linear" ? linearSetup() : vikunjaSetup();
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
