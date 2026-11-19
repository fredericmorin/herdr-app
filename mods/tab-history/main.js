// Tab history: remembers the tabs you leave, across spaces, and `tab-history.back` (ctrl--)
// shows the one before, like VS Code's Go Back. Pressing it again keeps going back. Draws nothing.

import { View, div } from "gpui-kit";
import { focused, spaces, run, nextCommand, checking } from "herdr";

const LIMIT = 50;

export default class TabHistory extends View {
  init(_props, cx) {
    this.history = []; // tab ids, oldest first
    this.current = focused()?.tab ?? null;
    this.goingBack = false;
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "back") this.back();
        cx.notify();
      }
    });
  }

  back() {
    const open = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
    while (this.history.length > 0) {
      const id = this.history.pop();
      if (id === this.current || !open.has(id)) continue;
      this.goingBack = true;
      run("tab.select", { id });
      return;
    }
  }

  // Herdr re-renders on every focus change, so this is where a tab switch is noticed.
  track() {
    const tab = focused()?.tab ?? null;
    if (!tab || tab === this.current) return;
    if (this.current && !this.goingBack) {
      this.history.push(this.current);
      if (this.history.length > LIMIT) this.history.shift();
    }
    this.goingBack = false;
    this.current = tab;
  }

  render() {
    this.track();
    return div();
  }
}
