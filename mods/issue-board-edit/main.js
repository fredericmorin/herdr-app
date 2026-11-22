// Creates a Vikunja task in a bucket, or edits a task's title and description (the issue board's
// "+" and Edit). Props { mode: "new" | "edit", url, project, view, bucket: {id, title},
// task: {id, identifier, title, description, labels: [{id, title}]} }. Descriptions are read and written as Markdown.
// Model and Effort set the task's model/ and effort/ labels (Default: none), which the Board's Start
// hands to claude-new. Those labels must already exist in Vikunja (this token can't create labels).
// After a save, shared "issue-board.changed" gets Date.now() so the board refreshes; on an error the
// dialog stays open with what was typed. Enter in the title or Cmd+Enter saves, Esc cancels.
// Props { tracker: "linear", create: { team, state?, assignee?, cycle?, project? } } (a Board's Linear chip):
// the same dialog for a Linear issue, through Linear's MCP server (./linear.js): get_issue, then save_issue
// with the title and description (and create's fields for a new one). No Model or Effort rows: Linear
// issues keep no model/effort labels (they're picked in claude-new).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, checking, setShared } from "herdr";
import { mcp, MODELS, EFFORTS, SETTING, setting } from "./vikunja.js";
import { linear } from "./linear.js";

const withOwn = (list, value) => (!value || list.includes(value) ? list : [...list, value]);

export default class IssueBoardEdit extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.linear = p.tracker === "linear";
    this.edit = p.mode === "edit";
    this.taskId = p.task?.id;
    this.labels = p.task?.labels ?? [];  // the task's labels as last read: a save keeps all but model/effort
    this.model = setting(this.labels, "model");
    this.effort = setting(this.labels, "effort");
    this.error = "";
    this.saving = false;
    this.title = InputState.new({ placeholder: "Title" });
    this.description = TextareaState.new({ placeholder: "Description (Markdown, optional)", rows: 6 });
    this.description.set_auto_grow(6, 18);
    if (this.edit) {
      this.title.set_value(p.task?.title ?? "");
      this.description.set_value(p.task?.description ?? "");
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
    if (this.edit && !checking()) this.readFresh(p, cx);
  }

  // The card's copy can be a minute old: read the task again, but only replace fields that still
  // hold the card's copy. Compares the values themselves, so it doesn't depend on when change events fire.
  readFresh(p, cx) {
    cx.spawn(async (cx) => {
      try {
        const fresh = this.linear ? await linear("get_issue", { id: p.task.id })
          : await mcp(p.url, "tasks_read", { task: p.task.id, format: "markdown",
            fields: ["title", "description", "labels.id", "labels.title"] });
        if (this.linear) fresh.labels = [];
        const rowsUntouched = this.model === setting(this.labels, "model") && this.effort === setting(this.labels, "effort");
        this.labels = fresh.labels ?? [];
        if (rowsUntouched) {
          this.model = setting(this.labels, "model");
          this.effort = setting(this.labels, "effort");
        }
        const untouched = this.title.value() === (p.task.title ?? "") && this.description.value() === (p.task.description ?? "");
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
    const p = props();
    const description = this.description.value();
    const wanted = [["model", this.model], ["effort", this.effort]];
    const relabel = !this.linear && wanted.some(([kind, value]) => value !== setting(this.labels, kind));
    this.saving = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const fail = (message) => { this.saving = false; this.error = message; cx.notify(); };
      try {
        // Labels are looked up first: a missing one stops the save before anything is written.
        const chosen = [];
        for (const [kind, value] of relabel ? wanted : []) {
          if (!value) continue;
          const name = `${kind}/${value}`;
          const found = await mcp(p.url, "labels_list", { q: name, fields: ["id", "title"] });
          const label = (found.items ?? []).find(l => l.title === name);
          if (!label) return fail(`No "${name}" label in Vikunja: create it there first.`);
          chosen.push(label);
        }
        if (this.linear) {
          const made = await linear("save_issue", this.edit ? { id: this.taskId, title, description } : { ...p.create, title, description });
          // From here on this dialog edits the issue it made: saving again after an error can't make a second one.
          this.edit = true;
          this.taskId ??= made?.id;
        } else if (this.edit) {
          await mcp(p.url, "tasks_update", { task: this.taskId, title, description, format: "markdown" });
        } else {
          const made = await mcp(p.url, "tasks_create", { project: p.project, title, description, bucket_id: p.bucket.id, format: "markdown" });
          // From here on this dialog edits the task it made: saving again after an error can't make a second one.
          this.edit = true;
          this.taskId = made.id;
          this.labels = [];
        }
        if (relabel) {
          const labels = [...this.labels.filter(l => !SETTING.test(l.title ?? "")), ...chosen].map(l => ({ id: l.id, title: l.title }));
          await mcp(p.url, "do_action", { action: "task_labels_bulk_replace", arguments: { task: this.taskId, labels } });
        }
      } catch (e) {
        if (this.linear) {
          return fail(e.status === 0 || e.status === 401 ? "Not signed in to Linear: sign in from the Board."
            : e.status === 429 ? "Linear is rate-limiting: try again in a few minutes."
            : `Couldn't save: ${e.message}`);
        }
        return fail(e.status === 0 ? "No Vikunja API token."
          : e.status === 401 || e.status === 403 ? "This token can't write tasks: give it write access to tasks in Vikunja."
          : `Couldn't save: ${e.message}`);
      }
      setShared("issue-board.changed", Date.now());
      closeOverlay(p.overlay);
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  cycle(step, cx) {
    const order = this.linear ? ["title", "description"] : ["title", "description", "model", "effort"];
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
    const p = props() ?? {};
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
        .child(div().flex_1().text_size(15).font_semibold().child(`${this.edit ? "Edit" : "New"} ${this.linear ? "issue" : "task"}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(this.edit ? `Editing ${p.task?.identifier ?? `${this.linear ? "issue" : "task"} ${this.taskId}`}` : `New ${this.linear ? "issue" : "task"} in ${p.bucket?.title ?? "this column"}`))
      .child(field(Input.new(this.title).h(36), this.at === "title"))
      .child(div().h(8))
      .child(field(Textarea.new(this.description).py(8), this.at === "description"))
      .when(!this.linear, el => el.child(div().h(10))
        .child(v_flex().gap(4)
          .child(choice("vt-model", this.modelHandle, "model", "Model", withOwn(MODELS, this.model), this.model, (v) => { this.model = v; }))
          .child(choice("vt-effort", this.effortHandle, "effort", "Effort", withOwn(EFFORTS, this.effort), this.effort, (v) => { this.effort = v; }))))
      .child(div().h(16).pt(4).text_size(11).text_color(t.blocked).child(this.error))
      .child(h_flex().pt(12).gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↩ to save"))
        .child(button("vt-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("vt-save", this.saving ? "Saving…" : "Save", true, (_e, cx) => this.save(cx))));
  }
}
