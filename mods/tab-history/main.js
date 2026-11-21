// Tab history: remembers the places you leave, across spaces, and `tab-history.back` (ctrl--)
// shows the one before, like VS Code's Go Back. Pressing it again keeps going back. Draws nothing.
// A place is a tab plus what the layout's `center` stack shows (Terminals or Board), when it has one.

import { View, div } from "gpui-kit";
import { focused, spaces, layout, run, nextCommand, checking } from "herdr";

const LIMIT = 50;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function here() {
  const tab = focused()?.tab ?? null;
  if (!tab) return null;
  return { tab, view: find(layout(), "center")?.active ?? null };
}

function same(a, b) {
  return a?.tab === b?.tab && a?.view === b?.view;
}

export default class TabHistory extends View {
  init(_props, cx) {
    this.history = []; // places, oldest first
    this.current = here();
    this.target = null; // the place `back` is going to; changes on the way there aren't recorded
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
      const place = this.history.pop();
      if (same(place, this.current) || !open.has(place.tab)) continue;
      this.target = place;
      if (place.tab !== this.current?.tab) run("tab.select", { id: place.tab });
      if (place.view && place.view !== this.current?.view) run("layout.select", { stack: "center", child: place.view });
      return;
    }
  }

  // Herdr re-renders on every focus and layout change, so this is where a switch is noticed.
  track() {
    const now = here();
    if (!now || same(now, this.current)) return;
    // Somewhere unrelated to where `back` was going: that trip is over.
    if (this.target && now.tab !== this.target.tab && now.view !== this.target.view) this.target = null;
    if (this.current && !this.target) {
      this.history.push(this.current);
      if (this.history.length > LIMIT) this.history.shift();
    }
    if (same(now, this.target)) this.target = null;
    this.current = now;
  }

  render() {
    this.track();
    return div();
  }
}
