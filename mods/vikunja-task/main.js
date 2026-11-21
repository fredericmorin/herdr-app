// Creates a Vikunja task in a bucket, or edits a task's title and description (the Vikunja board's
// "+" and Edit). Props { mode: "new" | "edit", url, project, view, bucket: {id, title},
// task: {id, identifier, title, description} }. Descriptions are read and written as Markdown.
// After a save, shared "vikunja.changed" gets Date.now() so the board refreshes; on an error the
// dialog stays open with what was typed. Enter in the title or Cmd+Enter saves, Esc cancels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, checking, setShared } from "herdr";
import { mcp } from "./vikunja.js";

export default class VikunjaTask extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.edit = p.mode === "edit";
    this.error = "";
    this.saving = false;
    this.title = InputState.new({ placeholder: "Title" });
    this.description = TextareaState.new({ placeholder: "Description (Markdown, optional)", rows: 6 });
    this.description.set_auto_grow(6, 18);
    if (this.edit) {
      this.title.set_value(p.task?.title ?? "");
      this.description.set_value(p.task?.description ?? "");
    }
    this.at = "title";  // what has the keyboard, for Tab
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
    // Window-level Tab moves focus across the window; our own bindings keep it in the dialog.
    cx.bind_keys([
      { keystroke: "tab", action: "vikunja_task_next", context: "VikunjaTask" },
      { keystroke: "shift-tab", action: "vikunja_task_next", context: "VikunjaTask" },
    ]);
    if (this.edit && !checking()) this.readFresh(p, cx);
  }

  // The card's copy can be a minute old: read the task again, but only replace fields that still
  // hold the card's copy. Compares the text itself, so it doesn't depend on when change events fire.
  readFresh(p, cx) {
    cx.spawn(async (cx) => {
      try {
        const fresh = await mcp(p.url, "tasks_read", { task: p.task.id, format: "markdown", fields: ["title", "description"] });
        const untouched = this.title.value() === (p.task.title ?? "") && this.description.value() === (p.task.description ?? "");
        if (!untouched) return;
        this.title.set_value(fresh.title ?? "");
        this.description.set_value(fresh.description ?? "");
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
    const [tool, args] = this.edit
      ? ["tasks_update", { task: p.task.id, title, description, format: "markdown" }]
      : ["tasks_create", { project: p.project, title, description, bucket_id: p.bucket.id, format: "markdown" }];
    this.saving = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await mcp(p.url, tool, args);
      } catch (e) {
        this.saving = false;
        this.error = e.status === 0 ? "No Vikunja API token."
          : e.status === 401 || e.status === 403 ? "This token can't write tasks: give it write access to tasks in Vikunja."
          : `Couldn't save: ${e.message}`;
        cx.notify();
        return;
      }
      setShared("vikunja.changed", Date.now());
      closeOverlay(p.overlay);
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  swapFocus(cx) {
    if (this.at === "title") { this.at = "description"; this.description.focus(); }
    else { this.at = "title"; this.title.focus(); }
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
    return v_flex().id("vikunja-task").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .key_context("VikunjaTask")
      .on_action("vikunja_task_next", (_e, cx) => this.swapFocus(cx))
      .w_full().p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(this.edit ? "Edit task" : "New task"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(this.edit ? `Editing ${p.task?.identifier ?? `task ${p.task?.id}`}` : `New task in ${p.bucket?.title ?? "this column"}`))
      .child(field(Input.new(this.title).h(36), this.at === "title"))
      .child(div().h(8))
      .child(field(Textarea.new(this.description).py(8), this.at === "description"))
      .child(div().h(16).pt(4).text_size(11).text_color(t.blocked).child(this.error))
      .child(h_flex().pt(12).gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↩ to save"))
        .child(button("vt-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("vt-save", this.saving ? "Saving…" : "Save", true, (_e, cx) => this.save(cx))));
  }
}
