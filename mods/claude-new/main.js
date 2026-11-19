// Starts a fresh Claude Code session in a new tab of the focused space, in the focused
// terminal's folder, with a prompt as its first message (`mod.open claude-new`).
// Same as the herdr-new Claude skill. Enter starts, Esc cancels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, focused, props, closeOverlay, theme } from "herdr";

export default class ClaudeNew extends View {
  init(_props, cx) {
    // Read now: the dialog takes the keyboard, the target is what was focused before it.
    this.target = focused();
    this.input = InputState.new({ placeholder: "First message (optional)" });
    this.input.on("submit", () => this.submit());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const prompt = this.input.value().trim();
    closeOverlay(props().overlay);
    // `--` keeps a prompt that starts with "-" from being read as an option.
    const argv = prompt ? ["claude", "--", prompt] : ["claude"];
    run("tab.new", { space: this.target?.space, folder: this.target?.cwd, argv });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("claude-new").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("New Claude session"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(14).text_size(11.5).text_color(t.dim)
        .child(`A new tab in this space, in ${this.target?.cwd ?? "the focused terminal's folder"}`))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("cn-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("cn-start", "Start", true, () => this.submit())));
  }
}
