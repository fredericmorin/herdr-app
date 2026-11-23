// Status hub: the one place that fetches each space's git facts, its repos' worktrees
// and its PR/MR status, published as shared `status.*` keys for other mods to read
// (contract: README.md). Draws nothing; runs as a floating block.

import { View, div } from "gpui-kit";
import { checking } from "herdr";
import { GitStatus } from "./git.js";
import { ReviewStatus } from "./reviews.js";

export default class StatusHub extends View {
  init(_props, cx) {
    if (checking()) return;
    this.git = new GitStatus();
    this.reviews = new ReviewStatus();
    // Cheap when nothing is due: no git runs, no task (see GitStatus.due).
    cx.timer.every(250, (cx) => {
      this.git.tick(cx);
      this.reviews.refresh(this.git.places(), cx);
    });
  }

  render() {
    return div();
  }

  async close() {
    this.git?.close();
  }
}
