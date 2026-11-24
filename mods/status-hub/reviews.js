// Each space's pull request (GitHub, gh) or merge request (GitLab, glab), published
// as shared `status.reviews`. Git runs on the space's machine, gh and glab run here
// with the person's own login.
// The GitHub part is ported from my-spaces' pr-status.js, itself adapted from Better
// Sidebar's git/pr-status.js (github.com/munza/herdr-mods, Copyright 2026 Tawsif Aqib,
// Apache License 2.0). ciState() is from cc-status (github.com/digitaltracer/herdr-plugins, MIT).
import { exec, setShared } from "herdr";

const PR_POLL_MS = 60000;
const PR_FIELDS =
  "id,number,title,url,state,isDraft,headRefName,headRepository,updatedAt,statusCheckRollup,reviewDecision,mergeStateStatus";
const PR_LIST_FIELDS = "id,number,headRefName,headRepository";
const PIPELINE_PENDING = new Set(["running", "pending", "created", "waiting_for_resource", "preparing", "scheduled"]);

const FAILED = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "ERROR", "STARTUP_FAILURE"]);
function ciState(rollup) {
  if (!rollup?.length) return { ci: "none", failed: [] };
  const failed = [];
  let pending = false;
  for (const c of rollup) {
    const result = (c.conclusion || c.state || "").toUpperCase();
    if (FAILED.has(result)) failed.push({ name: c.name || c.context || "check", url: c.detailsUrl || c.targetUrl || null });
    else if ((c.__typename === "CheckRun" && (c.status || "").toUpperCase() !== "COMPLETED") || result === "PENDING" || result === "EXPECTED") pending = true;
  }
  return { ci: failed.length ? "fail" : pending ? "pending" : "pass", failed };
}

// Terminal PR states win over draft/CI flags left over from when it was open.
// `tone` is a theme color name: readers draw it as theme()[tone].
function prAppearance(pr) {
  if (pr.state === "MERGED") return { icon: "merged", tone: "ansi5", label: "Merged" };
  if (pr.state === "CLOSED") return { icon: "closed", tone: "ansi1", label: "Closed" };
  if (pr.isDraft) return { icon: "draft", tone: "dim", label: "Draft" };
  const failed = (pr.statusCheckRollup ?? []).some((check) =>
    ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
      String(check.conclusion || check.state || check.status).toUpperCase(),
    ),
  );
  const open = (tone, label, ready = false) => ({ icon: "pull-request", tone, label, ready });
  if (pr.mergeStateStatus === "DIRTY") return open("ansi1", "Conflicts");
  if (failed) return open("ansi1", "Checks failed");
  if (pr.reviewDecision === "CHANGES_REQUESTED") return open("ansi3", "Changes requested");
  // CLEAN is GitHub's own "mergeable now": an empty decision means no review is required.
  if (pr.mergeStateStatus === "CLEAN" && (pr.reviewDecision === "APPROVED" || !pr.reviewDecision))
    return open("ansi2", "Ready to merge", true);
  return open("ansi2", "Open");
}

function githubItem(pr) {
  const { ci, failed } = ciState(pr.statusCheckRollup);
  const state = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
  return {
    host: "github", repository: pr.repository, number: pr.number, title: pr.title,
    url: pr.url || `https://github.com/${pr.repository}/pull/${pr.number}`,
    state, ci, failed, updatedAt: pr.updatedAt ?? null, look: prAppearance(pr),
  };
}

// The same looks for a merge request, from `glab mr view`.
function mrAppearance(state, ci, mr) {
  if (state === "merged") return { icon: "merged", tone: "ansi5", label: "Merged" };
  if (state === "closed") return { icon: "closed", tone: "ansi1", label: "Closed" };
  if (state === "draft") return { icon: "draft", tone: "dim", label: "Draft" };
  const open = (tone, label, ready = false) => ({ icon: "pull-request", tone, label, ready });
  if (mr.has_conflicts) return open("ansi1", "Conflicts");
  if (ci === "fail") return open("ansi1", "Checks failed");
  if (mr.detailed_merge_status === "requested_changes") return open("ansi3", "Changes requested");
  if (mr.detailed_merge_status === "mergeable") return open("ansi2", "Ready to merge", true);
  return open("ansi2", "Open");
}

function gitlabItem(mr, repository) {
  const state = mr.state === "opened" ? (mr.draft ? "draft" : "open") : mr.state === "merged" ? "merged" : "closed";
  const pipeline = mr.head_pipeline?.status;
  let ci = "none";
  if (pipeline === "success") ci = "pass";
  else if (pipeline === "failed" || pipeline === "canceled") ci = "fail";
  else if (PIPELINE_PENDING.has(pipeline)) ci = "pending";
  const failed = ci === "fail" ? [{ name: "pipeline", url: mr.head_pipeline.web_url ?? null }] : [];
  return {
    host: "gitlab", repository, number: mr.iid, title: mr.title, url: mr.web_url,
    state, ci, failed, updatedAt: mr.updated_at ?? null, look: mrAppearance(state, ci, mr),
  };
}

// Only github.com remotes are supported. Never pass an arbitrary remote URL to gh.
function githubRepository(url) {
  return /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  )?.[1];
}

// gitlab.com or a host whose name contains "gitlab"; nested groups allowed. Never pass
// an arbitrary remote URL to glab: only { host, path } rebuilt from these parts.
function gitlabRepository(url) {
  const m = /^(?:https?:\/\/([\w.-]+)\/|git@([\w.-]+):|ssh:\/\/git@([\w.-]+)(?::\d+)?\/)((?:[\w.-]+\/)+[\w.-]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  );
  const host = m && (m[1] || m[2] || m[3]).toLowerCase();
  if (!host || !host.includes("gitlab")) return null;
  return { host, path: m[4] };
}

// One observer for the hub. refresh() runs on the hub's fast timer, so it does
// nothing (no task) unless a checkout is due.
export class ReviewStatus {
  constructor() {
    this.places = new Map(); // Current checkout snapshots, replaced on refresh.
    this.checked = new Map(); // Checkout key -> last attempt time and branch.
    this.entries = new Map(); // Checkout key -> { branch, items, error? }.
    this.cache = new Map(); // CLI argument list -> short-lived response cache.
    this.projectIds = new Map(); // "host/path" -> GitLab project id, for the session.
    this.published = "";
  }

  // places: [{ key, machine, folder, branch, repo }], keyed like status.git. A checkout
  // is looked at once a minute, or at once when its branch changes.
  refresh(places, cx) {
    this.places = new Map(places.filter((place) => place.folder && place.repo).map((place) => [place.key, place]));
    let gone = false;
    for (const key of this.entries.keys()) if (!this.places.has(key)) {
      this.entries.delete(key);
      gone = true;
    }
    if (gone) this.publish();
    for (const key of this.checked.keys()) if (!this.places.has(key)) this.checked.delete(key);
    for (const [key, value] of this.cache) if (Date.now() - value.at >= PR_POLL_MS) this.cache.delete(key);
    if (this.busy) return;

    const due = [...this.places].filter(([key, place]) => {
      const last = this.checked.get(key);
      return !last || last.branch !== place.branch || Date.now() - last.at >= PR_POLL_MS;
    });
    if (!due.length) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        for (const [key, place] of due) {
          if (!this.isCurrent(key, place)) continue;
          this.checked.set(key, { at: Date.now(), branch: place.branch });
          try {
            const items = await this.lookup(place);
            if (this.isCurrent(key, place)) this.entries.set(key, { branch: place.branch, items });
          } catch (error) {
            if (this.isCurrent(key, place)) {
              const previous = this.entries.get(key);
              // Keep the last good items on a network error, never across a branch switch.
              this.entries.set(key, {
                branch: place.branch,
                items: previous?.branch === place.branch ? previous.items : [],
                error: error.message,
              });
            }
          }
          this.publish();
        }
      } finally {
        this.busy = false;
      }
    });
  }

  publish() {
    const text = JSON.stringify(Object.fromEntries(this.entries));
    if (text === this.published) return;
    this.published = text;
    setShared("status.reviews", JSON.parse(text));
  }

  // A lookup may finish after a branch switch or the space closing: publish only if current.
  isCurrent(key, place) {
    return this.places.has(key) && this.places.get(key).branch === place.branch;
  }

  async lookup(place) {
    const git = (args) => exec("git", ["--no-optional-locks", ...args], { cwd: place.folder, on: place.machine });
    const head = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (head.code !== 0) {
      if (head.code === 1 || /not a git repository/i.test(head.stderr ?? "")) return [];
      throw new Error("Cannot read checkout branch");
    }
    const branch = head.stdout.trim();
    // An explicit binding (`git config branch.<b>.herdr-pr owner/repo#42`) wins over guessing.
    const association = await git(["config", "--get", `branch.${branch}.herdr-pr`]);
    if (association.code !== 0 && association.code !== 1) throw new Error("Cannot read PR association");
    const binding = /^([\w.-]+\/[\w.-]+)#([1-9][0-9]*)$/.exec(association.stdout?.trim() ?? "");
    if (binding) {
      const pr = await this.gh(["pr", "view", binding[2], "--repo", binding[1], "--json", PR_FIELDS]);
      return [githubItem({ ...pr, repository: binding[1] })];
    }

    const remotes = await git(["remote"]);
    if (remotes.code !== 0) throw new Error("Cannot read Git remotes");
    const github = new Set();
    const gitlab = new Map(); // "host/path" -> { host, path }
    for (const name of remotes.stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const result = await git(["remote", "get-url", name]);
      if (result.code !== 0) throw new Error("Cannot read Git remote URL");
      const repository = githubRepository(result.stdout);
      if (repository) github.add(repository);
      const lab = gitlabRepository(result.stdout);
      if (lab) gitlab.set(`${lab.host}/${lab.path}`, lab);
    }

    const candidates = [];
    const knownHeads = new Set([...github].map((repo) => repo.toLowerCase()));
    for (const repository of github) {
      // Cheap fields first: full fields on a busy branch like a fork-heavy repo's `main` make GitHub 502.
      const found = await this.gh([
        "pr", "list", "--repo", repository, "--head", branch, "--state", "all", "--limit", "100", "--json", PR_LIST_FIELDS,
      ]);
      for (const head of found) {
        // Branch names aren't unique across forks: only heads in this checkout's own remotes.
        if (head.headRefName !== branch || !knownHeads.has(head.headRepository?.nameWithOwner?.toLowerCase())) continue;
        const pr = await this.gh(["pr", "view", String(head.number), "--repo", repository, "--json", PR_FIELDS]);
        candidates.push({ ...githubItem({ ...pr, repository }), id: head.id ?? `${repository}#${head.number}` });
      }
    }
    if (gitlab.size) candidates.push(...await this.mergeRequests([...gitlab.values()], branch));

    const matches = [...new Map(candidates.map(({ id, ...item }) => [id, item])).values()]
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    // A reused branch shows its current PR, not a historical merged one.
    const open = matches.filter((item) => item.state === "open" || item.state === "draft");
    return open.length ? open : matches.slice(0, 1);
  }

  // The branch's merge requests in the checkout's GitLab remotes, each with its own id.
  async mergeRequests(remotes, branch) {
    const own = new Set();
    for (const r of remotes) own.add(await this.projectId(r));
    const found = [];
    for (const r of remotes) {
      const repo = `https://${r.host}/${r.path}`;
      const list = await this.glab(["mr", "list", "--source-branch", branch, "--all", "-R", repo, "--output", "json"]);
      for (const mr of list) {
        // Branch names aren't unique across forks: only sources in this checkout's own remotes.
        if (mr.source_branch !== branch || !own.has(mr.source_project_id)) continue;
        const full = mr.state === "opened" ? await this.glab(["mr", "view", String(mr.iid), "-R", repo, "--output", "json"]) : mr;
        found.push({ ...gitlabItem(full, r.path), id: `${r.host}/${r.path}!${mr.iid}` });
      }
    }
    return found;
  }

  async projectId(r) {
    const key = `${r.host}/${r.path}`;
    if (!this.projectIds.has(key)) {
      const project = await this.glab(["api", "--hostname", r.host, `projects/${encodeURIComponent(r.path)}`]);
      this.projectIds.set(key, project.id);
    }
    return this.projectIds.get(key);
  }

  gh(args) {
    return this.query("gh", args, "GitHub unavailable; check gh auth login");
  }

  glab(args) {
    return this.query("glab", args, "GitLab unavailable; check glab auth login");
  }

  async query(cli, args, unavailable) {
    const key = JSON.stringify([cli, ...args]);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < PR_POLL_MS) return cached.data;
    const at = Date.now();
    let result;
    try {
      result = await exec(cli, args);
    } catch (error) {
      // exec rejects when the program can't start (or on a timeout, which says so).
      if (/time/i.test(String(error?.message ?? error))) throw error;
      throw new Error(`${cli} not installed`);
    }
    if (result.code !== 0) throw new Error((result.stderr || unavailable).trim());
    const data = JSON.parse(result.stdout);
    this.cache.set(key, { at, data });
    return data;
  }
}
