// The board's edit dialog: a new item in a column (the "+"), or an item's title and description (Edit),
// saved through the board's tracker. The board opens issue-board again with props { edit: { tracker, url,
// column: {id, title}, task: {id, ref, title, description, labels: [{id, title}]} | null, … } } (the rest
// is the tracker's editProps). Descriptions are read and written as Markdown. A tracker with settings
// (Vikunja) adds Model and Effort rows: the task's model/ and effort/ labels, which the board's Start
// hands to claude-new. After a save, shared CHANGED gets Date.now() so the board refreshes; on an error
// the dialog stays open with what was typed. Enter in the title or Cmd+Enter saves, Esc cancels.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, checking, setShared } from "herdr";
import { vikunjaTracker } from "./tracker-vikunja.js";
import { linearTracker } from "./tracker-linear.js";

// Written after a save; the board refreshes when it changes.
export const CHANGED = "issue-board.changed";

const withOwn = (list, value) => (!value || list.includes(value) ? list : [...list, value]);
// A tracker without settings: no model or effort.
const NONE = () => ({ model: "", effort: "" });

export class EditDialog {
  init(_props, cx) {
    const edit = props()?.edit ?? {};
    this.edit = edit;
    this.tracker = edit.tracker === "linear" ? linearTracker() : vikunjaTracker({ url: edit.url });
    this.settingsOf = this.tracker.settings?.of ?? NONE;
    this.taskId = edit.task?.id ?? null;  // a new item's id once it's made: saving again edits it
    this.labels = edit.task?.labels ?? [];  // the task's labels as last read: a save keeps all but model/effort
    ({ model: this.model, effort: this.effort } = this.settingsOf(this.labels));
    this.error = "";
    this.saving = false;
    this.title = InputState.new({ placeholder: "Title" });
    this.description = TextareaState.new({ placeholder: "Description (Markdown, optional)", rows: 6 });
    this.description.set_auto_grow(6, 18);
    if (edit.task) {
      this.title.set_value(edit.task.title ?? "");
      this.description.set_value(edit.task.description ?? "");
    }
    this.at = "title";  // what has the keyboard, for Tab: "title", "description", "model" or "effort"
    this.title.on("focus", (_e, cx) => { this.at = "title"; cx.notify(); });
    this.description.on("focus", (_e, cx) => { this.at = "description"; cx.notify(); });
    const changed = (_e, cx) => { this.error = ""; cx.notify(); };
    this.title.on("change", changed);
    this.description.on("change", changed);
    this.title.on("submit", (_e, cx) => this.save(cx));
    // The textarea's submit is Enter (a new line) or Cmd+Enter (secondary): only the latter saves.
    this.description.on("submit", (e, cx) => { if (e.secondary) this.save(cx); });
    this.title.focus();
    cx.timer.after(600, () => { if (this.at === "title") this.title.focus(); });
    this.handle = cx.focus_handle();
    this.modelHandle = cx.focus_handle();
    this.effortHandle = cx.focus_handle();
    // Window-level Tab moves focus across the window; our own bindings keep it in the dialog.
    cx.bind_keys([
      { keystroke: "tab", action: "issue_board_edit_next", context: "IssueBoardEdit" },
      { keystroke: "shift-tab", action: "issue_board_edit_prev", context: "IssueBoardEdit" },
    ]);
    if (edit.task && !checking()) this.readFresh(cx);
  }

  // The card's copy can be a minute old: read the task again, but only replace fields that still
  // hold the card's copy. Compares the values themselves, so it doesn't depend on when change events fire.
  readFresh(cx) {
    const task = this.edit.task;
    cx.spawn(async (cx) => {
      try {
        const fresh = await this.tracker.read(task.id);
        const was = this.settingsOf(this.labels);
        const rowsUntouched = this.model === was.model && this.effort === was.effort;
        this.labels = fresh.labels ?? [];
        if (rowsUntouched) ({ model: this.model, effort: this.effort } = this.settingsOf(this.labels));
        const untouched = this.title.value() === (task.title ?? "") && this.description.value() === (task.description ?? "");
        if (untouched) {
          this.title.set_value(fresh.title ?? "");
          this.description.set_value(fresh.description ?? "");
        }
        cx.notify();
      } catch {}  // keep the card's copy
    });
  }

  save(cx) {
    if (this.saving) return;
    const title = this.title.value().trim();
    if (!title) {
      this.error = "Type a title.";
      this.title.focus();
      cx.notify();
      return;
    }
    const form = { id: this.taskId, labels: this.labels, title, description: this.description.value(),
      model: this.model, effort: this.effort };
    this.saving = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // From the moment it's made, this dialog edits the new item: saving again after an error can't make a second one.
        await this.tracker.save(this.edit, form, (id) => { this.taskId = id; this.labels = []; });
      } catch (e) {
        this.saving = false;
        this.error = this.tracker.problem(e, "save it", true).message;
        cx.notify();
        return;
      }
      setShared(CHANGED, Date.now());
      closeOverlay(props().overlay);
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  cycle(step, cx) {
    const order = this.tracker.settings ? ["title", "description", "model", "effort"] : ["title", "description"];
    this.focusAt(order[(order.indexOf(this.at) + step + order.length) % order.length], cx);
  }

  focusAt(at, cx) {
    this.at = at;
    if (at === "title") this.title.focus();
    else if (at === "description") this.description.focus();
    else if (at === "model") this.modelHandle.focus();
    else this.effortHandle.focus();
    cx.notify();
  }

  render() {
    const t = theme();
    const { task, column } = this.edit;
    const noun = this.tracker.noun;
    const settings = this.tracker.settings;
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    const field = (el, on) => el.px(10).rounded(9).border_1().border_color(on ? t.accent : t.input)
      .bg(t.background).text_size(12.8).text_color(t.foreground);
    // Chips with Default ("") first. Focusable so Tab reaches the row; ←/→ move the choice there.
    const choice = (id, handle, at, label, values, current, set) => {
      const all = ["", ...values];
      return h_flex().id(id).track_focus(handle).gap(4).items_center().px(4).py(2).rounded(6)
        .border_1().border_color(this.at === at ? t.accent : t.popover)
        .on_key_down((e, cx) => {
          const step = e.key === "right" ? 1 : e.key === "left" ? -1 : 0;
          if (!step) return;
          set(all[(all.indexOf(current) + step + all.length) % all.length]);
          this.error = "";
          cx.stop_propagation();
          cx.notify();
        })
        .child(div().w(48).text_size(12.5).text_color(t.muted).child(label))
        .children(all.map((v) => h_flex().id(`${id}-${v || "default"}`).h(24).px(9).items_center().rounded(6)
          .border_1().border_color(v === current ? t.accent : t.input).bg(v === current ? t.accent : t.background)
          .text_size(12).text_color(v === current ? t.accent_foreground : t.foreground).cursor_pointer()
          .on_click((_e, cx) => { set(v); this.error = ""; this.focusAt(at, cx); }).child(v || "Default")));
    };
    return v_flex().id("issue-board-edit").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .key_context("IssueBoardEdit")
      .on_action("issue_board_edit_next", (_e, cx) => this.cycle(1, cx))
      .on_action("issue_board_edit_prev", (_e, cx) => this.cycle(-1, cx))
      .w_full().p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(`${this.taskId ? "Edit" : "New"} ${noun}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(this.taskId ? `Editing ${task?.ref ?? `${noun} ${this.taskId}`}` : `New ${noun} in ${column?.title ?? "this column"}`))
      .child(field(Input.new(this.title).h(36), this.at === "title"))
      .child(div().h(8))
      .child(field(Textarea.new(this.description).py(8), this.at === "description"))
      .when(Boolean(settings), el => el.child(div().h(10))
        .child(v_flex().gap(4)
          .child(choice("vt-model", this.modelHandle, "model", "Model", withOwn(settings.models, this.model), this.model, (v) => { this.model = v; }))
          .child(choice("vt-effort", this.effortHandle, "effort", "Effort", withOwn(settings.efforts, this.effort), this.effort, (v) => { this.effort = v; }))))
      .child(div().h(16).pt(4).text_size(11).text_color(t.blocked).child(this.error))
      .child(h_flex().pt(12).gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↩ to save"))
        .child(button("vt-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("vt-save", this.saving ? "Saving…" : "Save", true, (_e, cx) => this.save(cx))));
  }
}
