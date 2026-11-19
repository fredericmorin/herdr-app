// The worktree jobs running now, one row each ("Removing qqq · 12s"), in the sidebar between
// Spaces and Agents. mods/worktree-jobs keeps the list in the shared value
// "worktree-jobs.running" ([{ id, verb, name, started }]) and shows or hides this block.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, theme } from "herdr";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default class WorktreeJobsStatus extends View {
  init(_props, cx) {
    // Elapsed seconds tick only while something runs (the block keeps running while hidden).
    cx.timer.every(1000, (cx) => {
      if ((shared("worktree-jobs.running") ?? []).length > 0) cx.notify();
    });
  }

  render() {
    const t = theme();
    const now = Date.now();
    const rows = (shared("worktree-jobs.running") ?? []).map((job) =>
      h_flex().id(`wj-${job.id}`).h(24).px(14).gap(8).items_center().text_size(12).text_color(t.muted)
        .child(div().text_color(t.accent).frames(SPINNER, 90))
        .child(div().flex_1().truncate().child(`${job.verb} ${job.name}`))
        .child(div().text_color(t.dim).child(`${Math.max(0, Math.round((now - job.started) / 1000))}s`)));
    return v_flex().id("worktree-jobs-status").size_full().justify_center().children(rows);
  }
}
