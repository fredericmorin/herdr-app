// The focused space's issue board, drawn from shared `status.board`: the status hub (mods/status-hub,
// board.js there) resolves the board from projects.json, loads it, and makes every Vikunja and Linear call.
// This mod only draws columns and cards and asks the hub for actions through `status.requests`
// (./requests.js): refresh, move, start, sign-in; the edit dialog's read and save.
// Cards open in the browser, move to another column, or start a Claude session: the hub reads the item and
// opens claude-new with the ticket as its first message; confirming there has the hub move the card
// (Vikunja: Plan or Doing; Linear: In Progress), and this mod shows the terminals again.
// The message ends with a "Vikunja ticket:" or "Linear ticket:" line: the session's vikunja-ticket or
// linear-ticket skill (~/.claude/skills) moves the card on from there.
// "+" in a column that takes new items, and Edit on a card, open this mod again as a dialog (./edit.js).
// `issue-board.new` (cmd-n through the keybind mod, while the board shows) is the To-Do column's "+".
// Start labels the session's terminal (vikunja.task=<id>, linear.issue=<ID>): while Claude runs there, the
// card shows that session's space, tab and status, a click goes to it, and Start gives way to a button
// that opens the item. Its space's pull/merge request (the status hub's `status.reviews`) shows under it
// (click opens it), and a Fix CI button when its checks failed: claude-new in that space and checkout
// (no worktree), with the failed checks as the first message.
// A done column shows its 10 most recently done cards; a Show all toggle under them lists the rest below it.
// A hidden column (Linear's "hidden") is only a name in the Hidden columns list and a Move target.
// Props { url }: read by the hub (the Vikunja instance). Props { edit }: the edit dialog (./edit.js).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, nextCommand, exec, openOverlay, appHome, home, checking, shared, layout, run, spaces, agents, terminals, focused, panes } from "herdr";
import { EditDialog } from "./edit.js";
import { request } from "./requests.js";

// claude-new writes { plan, at, ref } here when Start is confirmed; the hub moves the card, this mod shows the terminals.
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

// A path as projects.json writes it: ~/… under home.
const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);
// A column as a request sends it: without its cards.
const bare = ({ cards, ...column }) => column;

// Where a space is now: its first terminal's live folder, else where it was made. Its key in the status
// hub's status.git and status.reviews. Same as the hub's place() (a mod can't import another's files).
function placeOf(space, ps) {
  const tabs = new Set((space.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

// The space's PR/MR from the hub, only while it describes the branch the space is on:
// { item, space, folder } or null.
function reviewOf(space, ps) {
  if (!space) return null;
  const folder = placeOf(space, ps);
  const key = JSON.stringify([space.machine ?? null, folder]);
  const entry = shared("status.reviews")?.[key];
  const item = entry && entry.branch === shared("status.git")?.[key]?.branch ? entry.items?.[0] : null;
  return item ? { item, space: space.id, folder } : null;
}

// GitLab numbers its merge requests !N, GitHub its pull requests #N.
const sign = (item) => (item.host === "gitlab" ? "!" : "#");
const live = (item) => item.state === "open" || item.state === "draft";

// A review's state and checks in words, as cc-board's In review cards say them.
function reviewText(item) {
  let checks = "";
  if (live(item) && (item.ci === "running" || item.ci === "queued")) checks = ` · checks ${item.ci}`;
  else if (live(item) && item.ci === "manual") checks = " · checks waiting";
  else if (live(item) && item.ci === "pass" && !item.look.ready) checks = " · checks passed";
  else if (live(item) && item.ci === "fail" && item.look.label !== "Checks failed") checks = " · checks failed";
  return `${sign(item)}${item.number} ${item.look.label}${checks}`;
}

// Fix CI: a new Claude session in the card's space and checkout, asked to fix the failed checks.
function fixCi(review) {
  const { item } = review;
  const checks = item.failed.map((f) => `- ${f.name}${f.url ? `: ${f.url}` : ""}`).join("\n");
  const message = [`The CI of ${item.repository}${sign(item)}${item.number} failed: ${item.url}`,
    ...(checks ? ["", "Failed checks:", checks] : []), "",
    "Read the failed jobs' logs (gh or glab), find the cause and fix it on this branch."].join("\n");
  showTerminals();
  openOverlay({ mod: "claude-new", kind: "dialog", width: 560,
    props: { space: review.space, folder: review.folder, worktree: false, plan: false, message } });
}

class Board {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.key = null;        // the board the Move row and Show all belong to
    this.moving = null;     // the card whose Move row is open
    this.showAll = false;   // a done column lists every card, not only the RECENT latest
    this.space = undefined; // the focused space at the last render
    this.copied = "";       // the hint line last copied: its button says Copied
    // The last confirmed start handled: a new copy takes the current one as handled, so it never replays an old start.
    this.lastStarted = shared(STARTED)?.at ?? 0;
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() === "new") this.newTask();
      }
    });
    // Redraws the "synced …s ago" label each second.
    cx.timer.every(1000, (cx) => { if (shared("status.board")?.syncedAt) cx.notify(); });
  }

  // A start confirmed in claude-new (tab.new already selected its tab): show it. The hub moves the card.
  handleStarted() {
    const s = shared(STARTED);
    if (!s?.at || s.at <= this.lastStarted) return;
    this.lastStarted = s.at;
    showTerminals();
  }

  // Going to another space while the Board shows hands the keyboard to that space's terminal, hidden
  // behind the Board, where keys reach nothing: the Board takes it. my-tabs gives it back to the pane
  // when the terminals show again (board-toggle).
  watch(cx) {
    const space = focused()?.space ?? null;
    const last = this.space;
    this.space = space;
    // render can't move focus: a timer does it after render returns.
    if (last !== undefined && space !== last && onBoard()) cx.timer.after(0, () => this.handle.focus());
  }

  // Each item's live Claude session, from the label Start put on its terminal: "key=value" ->
  // { pane, status, where, review }. A terminal left with only its shell (Claude exited) doesn't count.
  sessions(b) {
    const keys = (b.trackers ?? []).map(t => t.labelKey);
    const byAddress = new Map(agents().map(a => [a.address, a]));
    const all = spaces();
    const ps = panes();
    const tabs = new Map(all.flatMap(s => (s.tabs ?? []).map(c => [c.id, { space: s.name, tab: c.name, named: c.named }])));
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
        found.set(label, { pane: agent.pane, status: agent.status, where: `${at?.space ?? agent.space_name} › ${tab}`,
          review: reviewOf(all.find(s => s.id === agent.space), ps) });
      }
    }
    return found;
  }

  // The tracker can take edits: known, not read-only, not waiting for setup.
  writable(b) {
    return Boolean(b.tracker) && !b.readOnly && !b.setup;
  }

  // A new item in the first column that takes one (To-Do), as its "+" does.
  newTask() {
    const b = shared("status.board") ?? {};
    if (!this.writable(b)) return;
    const columns = b.columns ?? [];
    const column = columns.find(c => c.todo && c.add) ?? columns.find(c => c.add);
    if (column) this.editTask(b, column, null);
  }

  // Opens this mod again as the edit dialog (./edit.js): a new item in column, or item to edit.
  editTask(b, column, item) {
    if (!b.key) return;
    const task = item && { id: item.id, ref: item.ref, title: item.title, description: item.description,
      labels: item.labels.map(l => ({ id: l.id, title: l.title })), model: item.model ?? "", effort: item.effort ?? "" };
    openOverlay({ mod: "issue-board", kind: "dialog", width: 520, props: { edit: {
      key: b.key, tracker: b.tracker.name, noun: b.tracker.noun, column: { id: column.id, title: column.title }, task,
      settings: b.tracker.settings } } });
  }

  render(cx) {
    this.handleStarted();
    this.watch(cx);
    const b = shared("status.board") ?? {};
    const tracker = b.tracker;
    const columns = b.columns ?? [];
    // Another board: its Move row and Show all start over.
    if (b.key !== this.key) {
      this.key = b.key;
      this.moving = null;
      this.showAll = false;
    }
    const sessions = this.sessions(b);
    const t = theme();
    const stop = (_e, cx) => cx.stop_propagation();
    const writable = this.writable(b);
    const openTracker = () => exec("open", [b.openUrl]);
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
        .when(Boolean(session?.review), el => el.child(h_flex().id(`review-${item.id}`).gap(6).items_center().text_size(11.5)
          .text_color(t[session.review.item.look.tone] ?? t.muted).cursor_pointer()
          .tooltip(`${session.review.item.repository}${sign(session.review.item)}${session.review.item.number} · ${session.review.item.title}`)
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(session.review.item.url); })
          .child(svg(`mods/status-hub/icons/${session.review.item.look.icon}.svg`).size(12).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(reviewText(session.review.item)))))
        .when(item.labels.length > 0 || date || Boolean(item.who), el => el.child(h_flex().flex_wrap().gap(4).items_center()
          .children(item.labels.map(l => div().px(6).h(18).flex().items_center().rounded(4).text_size(11)
            .bg(`${l.color}33`).text_color(t.foreground).child(l.title)))
          .when(Boolean(date), el => el.child(div().text_size(11).text_color(date.late && !item.done ? t.blocked : t.dim).child(date.text)))
          .when(Boolean(item.who), el => el.child(div().text_size(11).text_color(t.dim).child(item.who)))))
        .child(h_flex().gap(4)
          .child(session
            ? button(`open-${item.id}`, tracker.title, () => browse())
            : button(`start-${item.id}`, "Start", () => request("board.start", { key: b.key, item, column: bare(column) })))
          .when(Boolean(session?.review && live(session.review.item) && session.review.item.ci === "fail"),
            el => el.child(button(`fix-${item.id}`, "Fix CI", () => fixCi(session.review))))
          .when(writable, el => el.child(button(`edit-${item.id}`, "Edit", () => this.editTask(b, column, item))))
          .when(writable && columns.length > 1, el => el.child(button(`move-${item.id}`, moving ? "Cancel" : "Move", (_e, cx) => { this.moving = moving ? null : item.id; cx.notify(); }))))
        .when(moving, el => el.child(h_flex().flex_wrap().gap(4)
          .children(columns.filter(c => c.id !== column.id).map(c => button(`to-${item.id}-${c.id}`, `→ ${c.title}`, (_e, cx) => {
            this.moving = null;
            request("board.move", { key: b.key, item, column: bare(c) });
            cx.notify();
          })))));
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
          .when(writable && col.add, el => el.child(button(`new-${col.id}`, "+", () => this.editTask(b, col, null)))))
        .child(v_flex().id(`cards-${col.id}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
          .children(head.map(item => card(item, col)))
          .when(rest.length > 0, el => el.child(row(`more-${col.id}`, this.showAll ? "Show fewer" : `Show all (${rest.length} more)`,
            (_e, cx) => { this.showAll = !this.showAll; cx.notify(); })))
          .when(this.showAll, el => el.children(rest.map(item => card(item, col))))
          // A capped column isn't the whole list: the rest is in the tracker.
          .when(col.capped, el => el.child(row(`capped-${col.id}`, `More in ${tracker.title}`, openTracker)))
          .when(cards.length === 0, el => el.child(div().p(10).text_size(11.5).text_color(t.dim).child("Nothing here"))));
    };

    // Linear's "Hidden columns": names only.
    const hiddenList = (cols) => v_flex().id("hidden-columns").w(220).flex_none().gap(6)
      .child(div().px(2).text_size(12).text_color(t.muted).child("Hidden columns"))
      .children(cols.map(col => h_flex().id(`hidden-${col.id}`).h(32).px(10).gap(8).items_center().rounded(6)
        .bg(t.background).border_1().border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(col.title))
        .child(div().text_size(11).text_color(t.dim).child(String(col.cards.length)))));

    const header = h_flex().flex_none().gap(8).px(12).py(10).items_center().border_b(1).border_color(t.border)
      .child(div().h(26).flex().items_center().text_size(13).font_semibold().text_color(t.foreground)
        .child(b.key ? b.title : "Issue board"))
      .when(Boolean(b.key), el => el.child(div().text_size(11.5).text_color(t.dim).child(`${tracker.title} · ${tilde(b.repo)}`)))
      .child(div().flex_1())
      .when(Boolean(b.loading), el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.dim).spin(900)))
      .when(Boolean(b.syncedAt), el => el.child(div().px(4).text_size(11).text_color(t.dim).child(`synced ${ago(b.syncedAt)}`)))
      .child(button("refresh", "↻", () => request("board.refresh")))
      .when(Boolean(b.key), el => el.child(button("open-tracker", `Open in ${tracker.title}`, openTracker)));

    // A line to paste somewhere else, with its Copy button.
    const code = (id, text) => h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).font_family("JetBrains Mono").text_size(12).text_color(t.foreground).child(text))
      .child(button(`copy-${id}`, this.copied === text ? "Copied" : "Copy",
        (_e, cx) => { cx.write_to_clipboard(text); this.copied = text; cx.notify(); }));

    // A tracker that needs a token or a sign-in: what to do, as the tracker says.
    const setupView = (s) => v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
      .child(div().text_color(t.foreground).font_semibold().child(s.title))
      .children((s.steps ?? []).flatMap((step, i) => [
        div().when(i > 0, d => d.pt(4)).child(step.text),
        ...(step.copy ? [code(`setup-${i}`, step.copy)] : [])]))
      .when(Boolean(s.signIn), el => el.child(h_flex().pt(4).child(b.signingIn
        ? div().text_size(12).text_color(t.dim).child("Waiting for the sign-in in the browser…")
        : button("sign-in", s.signIn, () => request("board.signIn", { key: b.key })))));

    // A repo without a board: how to add one, for this repo, in each tracker's terms.
    const noBoard = () => {
      const key = b.repo ? tilde(b.repo) : null;
      return v_flex().p(20).gap(8).text_size(13).text_color(t.muted)
        .child(div().text_color(t.foreground).font_semibold().child("No issue board for this project"))
        .when(!key, el => el.child(div().child("This space isn't in a git repo on this computer, so it has no board.")))
        .when(Boolean(key), el => el
          .child(div().child(`Add one under ${key} in:`))
          .child(code("projects-json", `${tilde(appHome())}/projects.json`))
          .children((b.trackers ?? []).flatMap((tr, i) => [
            div().pt(4).child(`${i > 0 ? "or " : ""}${tr.hint}`),
            code(`board-${tr.name}`, `"${key}": { "board": ${tr.example} }`)])));
    };

    let body;
    // repo is left out until the hub has looked at the space.
    if (b.repo === undefined || b.boardError) {
      body = div();
    } else if (!b.key) {
      body = noBoard();
    } else if (b.setup) {
      body = setupView(tracker.setup);
    } else {
      const hidden = columns.filter(c => c.hidden);
      body = h_flex().id("columns").flex_1().min_h(0).p(12).gap(12).items_start().overflow_x_scrollbar()
        .children(columns.filter(c => !c.hidden).map(column))
        .when(hidden.length > 0, el => el.child(hiddenList(hidden)));
    }
    const problems = [b.boardError, b.error].filter(Boolean);

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
