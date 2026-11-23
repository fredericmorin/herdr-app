// Asks the status hub (mods/status-hub/board.js) for a board action: appends { id, op, args } to shared
// `status.requests`, which the hub takes and clears. Read and write in one synchronous call, so the Board
// and an edit dialog appending at once don't drop each other's request. Returns the id: the hub answers
// the edit dialog's task.read and task.save in shared `status.replies[id]`.
import { shared, setShared } from "herdr";

let sent = 0;

export function request(op, args = {}) {
  sent += 1;
  const id = `${Date.now()}-${sent}`;
  setShared("status.requests", [...(shared("status.requests") ?? []), { id, op, args }]);
  return id;
}
