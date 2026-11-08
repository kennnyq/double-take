"""Publish the current review session: its decisions, a candidate feed build, and (only
when asked) the deploy.

    npm run review:publish-prepare                  # decisions commit + build-next + summary
    npm run review:publish-deploy -- --dry-run      # print exactly what a deploy would do
    npm run review:publish-deploy                   # only after Kenny's yes

Both return at once: the work runs in a detached tmux session (review-publish-prepare,
review-publish-deploy), streams to a log, writes a status file, and notifies the
orchestrator inbox (~/.t3/orchestrator-inbox/review-publish-<time>.msg) when it ends.
A lock keeps two runs from overlapping; both are safe to re-run. --dry-run runs inline.

A **review session** is every decision made since the last successful publish, as
recorded in scripts/harvest/review/published.json (the last published decision's time
and id, the commit and the deployed Worker version). The marker moves only after a
deploy and `npm run check:prod` both succeed.

prepare (never touches build/):
  1. Decisions: main's scripts/harvest/review/decisions.jsonl plus any decisions not yet
     committed in the review checkouts (default: this checkout and the clip-review
     worktree, whose review server writes there), merged by event id. New events are
     committed on branch `review-publish` (from main, without touching any working tree)
     for the orchestrator to merge. Never pushed.
  2. Candidate: build-next as a hardlinked copy of build/, then build_media.py --merge
     --only-kept --exclude-discarded over every batch in scripts/harvest/ (only new kept
     clips are encoded; dedupe and the media guard run as always). Clip folders no feed
     lists any more are removed from build-next.
  3. Summary (build-next vs build/): the session first ("Review session since <time>: N
     decisions (K keep, D drop, S stars, M notes) -> +x / -y clips"), then the feed
     totals, files and sizes against Cloudflare's limits, and listed-vs-has-media.
     Notes and stars are listed for visibility only; they don't change the build.

deploy (after Kenny's yes):
  preflight the summary (build/ and build-next unchanged since prepare, no missing media,
  within limits) -> back up build/ to build-prev (older backups renamed with a timestamp,
  2 kept) -> swap build-next in via hardlinks -> deploy the Worker -> npm run check:prod
  -> move the published marker. Any failure after the backup rolls back: build-prev is
  restored and deployed again, and the status says so.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DECISIONS_REL = "scripts/harvest/review/decisions.jsonl"
MARKER_REL = "scripts/harvest/review/published.json"
BRANCH = "review-publish"
CLIP_REVIEW = "/home/kenny/.t3/worktrees/double-take/feat-clip-review"
INBOX = os.path.expanduser("~/.t3/orchestrator-inbox")
TOKEN_FILE = os.path.expanduser("~/.config/cloudflare/token")
MAX_FILES = 20_000
MAX_FILE_BYTES = 25 * 1024 * 1024
BACKUPS_KEPT = 2
# Mirrors worker/scripts/stage.ts's .assetsignore: what never ships as an asset.
IGNORED_DIRS = ("archive", "annotate")
IGNORED_FILES = re.compile(r"(^|/)\.DS_Store$|\.part$|\.tmp$")


# ---------------------------------------------------------------- pure logic (tested)

def parse_events(text: str) -> list[tuple[dict, str]]:
    """(event, raw line) for each valid review event, as review.py reads them."""
    out = []
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(e, dict) and all(isinstance(e.get(k), str) for k in ("id", "key", "at")) and (
                isinstance(e.get("undo"), str) or isinstance(e.get("set"), dict)):
            out.append((e, line))
    return out


def merge_logs(base_text: str, others: list[str]) -> tuple[str, list[dict]]:
    """main's log with every event the other logs add, appended in (at, id) order, so
    the file stays append-only and mergeable. Returns (text, new events)."""
    base = parse_events(base_text)
    seen = {e["id"] for e, _ in base}
    new: dict[str, tuple[dict, str]] = {}
    for text in others:
        for e, line in parse_events(text):
            if e["id"] not in seen:
                new.setdefault(e["id"], (e, line))
    added = sorted(new.values(), key=lambda p: (p[0]["at"], p[0]["id"]))
    lines = [line for _, line in base] + [line for _, line in added]
    return ("\n".join(lines) + "\n") if lines else "", [e for e, _ in added]


def session_events(events: list[dict], marker: dict | None) -> list[dict]:
    """Events after the last published one (by time, then id), in order."""
    evs = sorted(events, key=lambda e: (e["at"], e["id"]))
    if not marker or not marker.get("at"):
        return evs
    cut = (marker["at"], marker.get("cursor") or "")
    return [e for e in evs if (e["at"], e["id"]) > cut]


def session_counts(events: list[dict]) -> dict:
    """What a session did: keep / discard (drop) / needs-work / cleared statuses, undos,
    stars (picked tells) and notes (clip and tell notes), with the stars and notes listed."""
    c = {"decisions": len(events), "keep": 0, "drop": 0, "needsWork": 0, "cleared": 0, "undo": 0,
         "stars": [], "notes": []}
    for e in events:
        if "undo" in e:
            c["undo"] += 1
            continue
        s = e.get("set") or {}
        if "status" in s:
            key = {"keep": "keep", "discard": "drop", "needs-work": "needsWork", None: "cleared"}.get(s["status"])
            if key:
                c[key] += 1
        if isinstance(s.get("note"), str) and s["note"].strip():
            c["notes"].append({"key": e["key"], "by": e.get("by"), "note": s["note"].strip()})
        for ref, mark in (s.get("tells") or {}).items():
            if not isinstance(mark, dict):
                continue
            if mark.get("pick") is True:
                c["stars"].append({"key": e["key"], "tell": ref, "by": e.get("by")})
            if isinstance(mark.get("note"), str) and mark["note"].strip():
                c["notes"].append({"key": e["key"], "tell": ref, "by": e.get("by"), "note": mark["note"].strip()})
    return c


def label_kind(label: str | None) -> str:
    l = (label or "").lower()
    return "ai" if l in ("confirmed", "ai") else "real" if l in ("real", "not_ai", "authentic") else "other"


def feed_totals(clips: list[dict]) -> dict:
    t = {"clips": len(clips), "ai": 0, "real": 0, "other": 0}
    for c in clips:
        t[label_kind(c.get("label"))] += 1
    return t


def feed_diff(old: list[dict], new: list[dict]) -> dict:
    o, n = [c["id"] for c in old], [c["id"] for c in new]
    so, sn = set(o), set(n)
    return {"added": [i for i in n if i not in so], "removed": [i for i in o if i not in sn]}


def shipped_files(root: str) -> list[tuple[str, int]]:
    """(path relative to root, bytes) of every file the Worker would upload as an asset."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        if rel == ".":
            dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for f in filenames:
            p = os.path.normpath(os.path.join(rel, f))
            if not IGNORED_FILES.search(p):
                out.append((p, os.path.getsize(os.path.join(dirpath, f))))
    return out


def limits(files: list[tuple[str, int]], extra_files: int = 2) -> dict:
    """Against Cloudflare's static-asset limits. `extra_files`: what stage.ts adds
    (asset-manifest.json, .assetsignore) if they aren't there yet."""
    count = len(files) + extra_files
    largest = max(files, key=lambda f: f[1]) if files else ("", 0)
    over = [p for p, s in files if s > MAX_FILE_BYTES]
    return {"files": count, "maxFiles": MAX_FILES, "bytes": sum(s for _, s in files),
            "largest": {"path": largest[0], "bytes": largest[1]}, "maxFileBytes": MAX_FILE_BYTES,
            "overSize": over, "ok": count <= MAX_FILES and not over}


def missing_media(root: str, clips: list[dict]) -> list[str]:
    return [f"{c['id']}:{k}" for c in clips for k in ("video", "poster")
            if not c.get(k) or not os.path.isfile(os.path.join(root, c[k]))]


def fmt_time(iso: str | None) -> str:
    return iso[:16].replace("T", " ") + " UTC" if iso else "the start"


def summary_line(s: dict) -> str:
    c, d, t, lim = s["session"]["counts"], s["diff"], s["after"], s["limits"]
    head = (f"Review session since {fmt_time(s['session']['since'])}: {c['decisions']} decisions "
            f"({c['keep']} keep, {c['drop']} drop, {len(c['stars'])} stars, {len(c['notes'])} notes) "
            f"-> +{len(d['added'])} / -{len(d['removed'])} clips.")
    feed = (f" Feed: {t['clips']} clips ({t['ai']} AI, {t['real']} real), {lim['bytes'] / 2**30:.2f} GiB, "
            f"{lim['files']}/{lim['maxFiles']} files, largest {lim['largest']['bytes'] / 2**20:.1f}/"
            f"{lim['maxFileBytes'] / 2**20:.0f} MiB, missing media {len(s['missing'])}.")
    return head + feed


def backup_plan(names: list[str], stamp: str, keep: int = BACKUPS_KEPT) -> dict:
    """How deploy rotates backups, given the names in the root folder: build-prev (if any)
    is renamed build-prev-<stamp>, and timestamped backups beyond `keep` - 1 are deleted,
    so `keep` backups remain once build/ becomes the new build-prev."""
    stamped = sorted((n for n in names if re.fullmatch(r"build-prev-\d{8}-\d{6}", n)), reverse=True)
    rename = "build-prev" in names
    if rename:
        stamped = [f"build-prev-{stamp}"] + stamped
    return {"rename": ("build-prev", f"build-prev-{stamp}") if rename else None,
            "delete": stamped[keep - 1:] if keep >= 1 else stamped}


def preflight(summary: dict | None, status: dict | None, live_hash: str | None, next_hash: str | None) -> list[str]:
    """Reasons not to deploy (empty list: go)."""
    if not summary:
        return ["no summary: run review:publish-prepare first"]
    errs = []
    if not status or status.get("state") != "done":
        errs.append(f"prepare didn't finish (state: {(status or {}).get('state')})")
    if summary.get("missing"):
        errs.append(f"{len(summary['missing'])} listed clip(s) without media")
    if not summary.get("limits", {}).get("ok"):
        errs.append("over Cloudflare's asset limits")
    if live_hash != summary.get("hashes", {}).get("live"):
        errs.append("build/ changed since prepare (re-run review:publish-prepare)")
    if next_hash != summary.get("hashes", {}).get("next"):
        errs.append("build-next changed since prepare (re-run review:publish-prepare)")
    return errs


# ---------------------------------------------------------------- side effects

class Ctx:
    def __init__(self, root: str, log=None):
        self.root = root
        self.build = os.path.join(root, "build")
        self.next = os.path.join(root, "build-next")
        self.prev = os.path.join(root, "build-prev")
        self.state = os.path.join(root, ".review-publish")
        os.makedirs(self.state, exist_ok=True)
        self.log = log or sys.stdout

    def say(self, msg: str) -> None:
        print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", file=self.log, flush=True)

    def path(self, name: str) -> str:
        return os.path.join(self.state, name)

    def git(self, *args: str, input: str | None = None, env: dict | None = None) -> str:
        return subprocess.run(["git", "-C", self.root, *args], input=input, capture_output=True, text=True,
                              check=True, env={**os.environ, **(env or {})}).stdout.strip()


def write_json(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def read_json(path: str) -> dict | None:
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def file_hash(path: str) -> str | None:
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


def notify(state: str, lines: list[str], log_path: str) -> None:
    os.makedirs(INBOX, exist_ok=True)
    body = [f"[review-publish] {state}"] + lines[:2] + [f"- log: {log_path}"]
    with open(os.path.join(INBOX, f"review-publish-{int(time.time())}.msg"), "w") as f:
        f.write("\n".join(body) + "\n")


def lock(ctx: Ctx):
    """Exclusive, non-blocking: None if another prepare or deploy holds it."""
    fd = os.open(ctx.path("lock"), os.O_CREAT | os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    os.ftruncate(fd, 0)
    os.write(fd, f"{os.getpid()}\n".encode())
    return fd


def commit_file(ctx: Ctx, base: str, rel: str, text: str, message: str, parent: str | None = None) -> str:
    """Commit one file's new content on BRANCH, on top of `parent` (default: base), without
    touching any working tree or the real index. Returns the commit id."""
    parent = parent or ctx.git("rev-parse", base)
    blob = ctx.git("hash-object", "-w", "--stdin", input=text)
    with tempfile.TemporaryDirectory() as d:
        env = {"GIT_INDEX_FILE": os.path.join(d, "index")}
        ctx.git("read-tree", parent, env=env)
        ctx.git("update-index", "--add", "--cacheinfo", f"100644,{blob},{rel}", env=env)
        tree = ctx.git("write-tree", env=env)
    if tree == ctx.git("rev-parse", f"{parent}^{{tree}}"):
        return parent
    commit = ctx.git("commit-tree", tree, "-p", parent, "-m", message)
    ctx.git("update-ref", f"refs/heads/{BRANCH}", commit)
    return commit


def git_show(ctx: Ctx, ref: str, rel: str) -> str | None:
    try:
        return ctx.git("show", f"{ref}:{rel}") + "\n"
    except subprocess.CalledProcessError:
        return None


def load_feed(root: str) -> list[dict]:
    data = read_json(os.path.join(root, "feeds", "demo.json"))
    return (data or {}).get("clips", [])


def prepare(ctx: Ctx, base: str, checkouts: list[str], jobs: int) -> dict:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base_sha = ctx.git("rev-parse", base)
    ctx.say(f"review publish prepare from {base} {base_sha[:7]} in {ctx.root}")

    # 1. Decisions: main's log plus uncommitted ones from the review checkouts.
    main_log = git_show(ctx, base_sha, DECISIONS_REL) or ""
    others = []
    for co in checkouts:
        p = os.path.join(co, DECISIONS_REL)
        if os.path.isfile(p):
            with open(p) as f:
                others.append(f.read())
            ctx.say(f"decisions from {p}")
    merged, new_events = merge_logs(main_log, others)
    decisions_path = ctx.path("decisions.jsonl")
    with open(decisions_path, "w") as f:
        f.write(merged)
    commit = base_sha
    if new_events:
        commit = commit_file(ctx, base_sha, DECISIONS_REL, merged,
                             f"chore(harvest): record review decisions for publish {stamp}\n\n"
                             f"- {len(new_events)} decision(s) not yet on {base}, from the review checkouts")
        ctx.say(f"committed {len(new_events)} new decision(s) on branch {BRANCH}: {commit[:7]} (not pushed)")
    else:
        ctx.say(f"no decisions beyond {base}; nothing to commit")
    marker = json.loads(git_show(ctx, base_sha, MARKER_REL) or "null")
    all_events = [e for e, _ in parse_events(merged)]
    session = session_events(all_events, marker)
    counts = session_counts(session)
    ctx.say(f"review session since {fmt_time((marker or {}).get('at'))}: {counts['decisions']} decisions")

    # 2. Candidate build: a hardlinked copy of build/, then only new kept clips are encoded.
    if not os.path.isdir(os.path.join(ctx.build, "feeds")):
        raise RuntimeError(f"no live build at {ctx.build}")
    if os.path.lexists(ctx.next):
        ctx.say(f"removing the old {ctx.next}")
        shutil.rmtree(ctx.next)
    subprocess.run(["cp", "-al", ctx.build, ctx.next], check=True)
    ctx.say(f"hardlinked {ctx.build} -> {ctx.next}")
    cands, seen = [], set()
    from build_media import clip_id
    batches = os.path.join(ctx.root, "scripts", "harvest")
    for name in sorted(os.listdir(batches)):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(batches, name)) as f:
            for line in f:
                if line.strip():
                    row = json.loads(line)
                    if row.get("url") and clip_id(row["url"]) not in seen:
                        seen.add(clip_id(row["url"]))
                        cands.append(row)
    cands_path = ctx.path("candidates.jsonl")
    with open(cands_path, "w") as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in cands)
    ctx.say(f"{len(cands)} candidate rows from scripts/harvest/*.jsonl")
    cmd = [sys.executable, "-I", os.path.join(HERE, "build_media.py"), cands_path, "--out", ctx.next, "--merge",
           "--only-kept", "--exclude-discarded", "--decisions", decisions_path, "--jobs", str(jobs)]
    ctx.say("$ " + " ".join(cmd))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        if not line.startswith("use "):
            ctx.say("  " + line.rstrip())
    if proc.wait() != 0:
        raise RuntimeError(f"build_media.py failed ({proc.returncode})")

    # Clip folders no feed lists any more (discarded, deduped) go; unlinking leaves build/ alone.
    listed = set()
    for name in os.listdir(os.path.join(ctx.next, "feeds")):
        if name.endswith(".json"):
            listed |= {c["id"] for c in (read_json(os.path.join(ctx.next, "feeds", name)) or {}).get("clips", [])}
    media = os.path.join(ctx.next, "media")
    pruned = [d for d in sorted(os.listdir(media)) if d not in listed] if os.path.isdir(media) else []
    for d in pruned:
        shutil.rmtree(os.path.join(media, d))
    ctx.say(f"pruned {len(pruned)} unlisted clip folder(s) from build-next" + (f": {', '.join(pruned)}" if pruned else ""))

    # 3. Summary.
    old, new = load_feed(ctx.build), load_feed(ctx.next)
    last = session[-1] if session else (all_events[-1] if all_events else None)
    summary = {
        "kind": "review-publish",
        "preparedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "root": ctx.root, "base": {"ref": base, "commit": base_sha},
        "decisionsCommit": commit if new_events else None, "branch": BRANCH if new_events else None,
        "session": {"since": (marker or {}).get("at"), "marker": marker, "counts": counts,
                    "last": {"at": last["at"], "id": last["id"]} if last else None},
        "diff": feed_diff(old, new), "before": feed_totals(old), "after": feed_totals(new),
        "limits": limits(shipped_files(ctx.next)), "missing": missing_media(ctx.next, new), "pruned": pruned,
        "hashes": {"live": file_hash(os.path.join(ctx.build, "feeds", "demo.json")),
                   "next": file_hash(os.path.join(ctx.next, "feeds", "demo.json"))},
    }
    summary["text"] = summary_line(summary)
    write_json(ctx.path("summary.json"), summary)
    with open(ctx.path("summary.txt"), "w") as f:
        f.write(summary["text"] + "\n")
    ctx.say(summary["text"])
    if summary["missing"] or not summary["limits"]["ok"]:
        raise RuntimeError("candidate not shippable: " + ("missing media" if summary["missing"] else "over limits"))
    return summary


def run(cmd: list[str], ctx: Ctx, env: dict | None = None, secret: str | None = None) -> str:
    """Run, stream to the log (masking `secret`), and return the output."""
    shown = " ".join(cmd)
    ctx.say("$ " + shown)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=ctx.root,
                            env={**os.environ, **(env or {})})
    out = []
    for line in proc.stdout:
        line = line.replace(secret, "***") if secret else line
        out.append(line)
        ctx.say("  " + line.rstrip())
    if proc.wait() != 0:
        raise RuntimeError(f"{shown} failed ({proc.returncode})")
    return "".join(out)


def deploy(ctx: Ctx, dry_run: bool) -> dict:
    summary = read_json(ctx.path("summary.json"))
    status = read_json(ctx.path("prepare.status.json"))
    live_hash = file_hash(os.path.join(ctx.build, "feeds", "demo.json"))
    next_hash = file_hash(os.path.join(ctx.next, "feeds", "demo.json"))
    errs = preflight(summary, status, live_hash, next_hash)
    if not dry_run and not os.path.isfile(TOKEN_FILE):
        errs.append(f"no Cloudflare token at {TOKEN_FILE}")
    ctx.say(("DRY RUN: " if dry_run else "") + "review publish deploy in " + ctx.root)
    if summary:
        ctx.say(summary["text"])
    if errs:
        raise RuntimeError("preflight failed: " + "; ".join(errs))
    ctx.say("preflight ok: build/ and build-next match the prepared summary, no missing media, within limits")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    plan = backup_plan(os.listdir(ctx.root), stamp)
    steps = []
    if plan["rename"]:
        steps.append(("rename", os.path.join(ctx.root, plan["rename"][0]), os.path.join(ctx.root, plan["rename"][1])))
    for d in plan["delete"]:
        steps.append(("delete", os.path.join(ctx.root, d)))
    steps += [("rename", ctx.build, ctx.prev), ("hardlink", ctx.next, ctx.build)]
    deploy_cmd = ["npm", "--prefix", os.path.join(ctx.root, "worker"), "run", "deploy"]
    check_cmd = ["npm", "run", "check:prod"]
    describe = {"rename": lambda s: f"mv {s[1]} {s[2]}", "delete": lambda s: f"rm -rf {s[1]}",
                "hardlink": lambda s: f"cp -al {s[1]} {s[2]}"}
    if dry_run:
        n = 0
        for s in steps:
            n += 1
            ctx.say(f"would {n}. {describe[s[0]](s)}")
        ctx.say(f'would {n + 1}. CLOUDFLARE_API_TOKEN="$(cat {TOKEN_FILE})" {" ".join(deploy_cmd)}   (stages build/, uploads changed assets)')
        ctx.say(f"would {n + 2}. {' '.join(check_cmd)}   (in {ctx.root})")
        ctx.say(f"would {n + 3}. write {MARKER_REL} (published up to {summary['session']['last']}) and commit it on {BRANCH}")
        ctx.say(f"on failure after step {len(steps) - 1}: rm -rf {ctx.build}; mv {ctx.prev} {ctx.build}; redeploy; {' '.join(check_cmd)}")
        ctx.say("dry run: nothing changed")
        return {"dryRun": True, "steps": [describe[s[0]](s) for s in steps]}

    for s in steps[:-2]:
        ctx.say(describe[s[0]](s))
        (os.rename(s[1], s[2]) if s[0] == "rename" else shutil.rmtree(s[1]))
    ctx.say(f"mv {ctx.build} {ctx.prev}")
    os.rename(ctx.build, ctx.prev)
    with open(TOKEN_FILE) as f:
        token = f.read().strip()
    env = {"CLOUDFLARE_API_TOKEN": token}
    try:
        ctx.say(f"cp -al {ctx.next} {ctx.build}")
        subprocess.run(["cp", "-al", ctx.next, ctx.build], check=True)
        out = run(deploy_cmd, ctx, env, secret=token)
        version = (re.findall(r"Current Version ID:\s*(\S+)", out) or [None])[-1]
        run(check_cmd, ctx)
    except Exception as e:
        ctx.say(f"FAILED: {e}; rolling back to {ctx.prev}")
        rolled = False
        try:
            if os.path.lexists(ctx.build):
                shutil.rmtree(ctx.build)
            os.rename(ctx.prev, ctx.build)
            run(deploy_cmd, ctx, env, secret=token)
            run(check_cmd, ctx)
            rolled = True
        except Exception as e2:
            ctx.say(f"ROLLBACK FAILED: {e2}")
        raise RuntimeError(f"deploy failed ({e}); rollback {'ok: the previous build is live again' if rolled else 'FAILED: check by hand'}")

    last = summary["session"]["last"] or {}
    marker = {"at": last.get("at"), "cursor": last.get("id"), "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "commit": summary.get("decisionsCommit") or summary["base"]["commit"], "deployVersion": version,
              "clips": summary["after"]}
    parent = summary.get("decisionsCommit") or summary["base"]["commit"]
    mcommit = commit_file(ctx, summary["base"]["commit"], MARKER_REL, json.dumps(marker, indent=2) + "\n",
                          f"chore(harvest): mark review session published {stamp}\n\n- Deployed {version}; "
                          f"{summary['after']['clips']} clips", parent=parent)
    ctx.say(f"published; marker committed on {BRANCH}: {mcommit[:7]} (not pushed)")
    return {"version": version, "markerCommit": mcommit}


# ---------------------------------------------------------------- entry points

def launch(cmd: str, argv: list[str], ctx: Ctx) -> int:
    """Start `cmd --run` in a detached tmux session and return at once."""
    session = f"review-publish-{cmd}"
    probe = lock(ctx)
    if probe is None or subprocess.run(["tmux", "has-session", "-t", session], capture_output=True).returncode == 0:
        print(f"review publish is already running (see {ctx.path(cmd + '.status.json')}); not starting another")
        return 1
    os.close(probe)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    log = ctx.path(f"{stamp}-{cmd}.log")
    inner = " ".join(["python3", "-I", os.path.abspath(__file__), cmd, "--run", "--log", log, *map(sh_quote, argv)])
    tmux = ["tmux", "new-session", "-d", "-s", session, inner]
    if shutil.which("systemd-run"):  # outlive the caller's process group, as the dev servers do
        tmux = ["systemd-run", "--user", "--scope", "--quiet", *tmux]
    subprocess.run(tmux, check=True, cwd=ctx.root)
    write_json(ctx.path(f"{cmd}.status.json"), {"state": "started", "log": log, "session": session,
                                                  "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    print(f"review publish {cmd}: started in tmux session {session}\n  log:    {log}\n  status: {ctx.path(cmd + '.status.json')}")
    return 0


def sh_quote(s: str) -> str:
    return s if re.fullmatch(r"[\w./=:-]+", s) else "'" + s.replace("'", "'\\''") + "'"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["prepare", "deploy"])
    ap.add_argument("--run", action="store_true", help="do the work here (what the tmux session runs)")
    ap.add_argument("--dry-run", action="store_true", help="deploy: print the plan, change nothing (runs inline)")
    ap.add_argument("--root", default=os.environ.get("REVIEW_PUBLISH_ROOT") or os.path.dirname(os.path.dirname(HERE)),
                    help="checkout whose build/ is the live build (default: this one)")
    ap.add_argument("--base", default="main", help="the branch decisions are merged onto")
    ap.add_argument("--checkout", action="append", default=None,
                    help="review checkout to collect uncommitted decisions from (default: root and the clip-review worktree)")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--log")
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    checkouts = args.checkout or [p for p in (root, CLIP_REVIEW) if os.path.isdir(p)]

    if not args.run and not (args.command == "deploy" and args.dry_run):
        passthrough = [a for a in sys.argv[2:] if a != "--run"]
        return launch(args.command, passthrough, Ctx(root))

    log = open(args.log, "a") if args.log else sys.stdout
    ctx = Ctx(root, log)
    fd = lock(ctx)
    if fd is None:
        ctx.say("another review publish holds the lock; stopping")
        return 1
    status_path = ctx.path(f"{args.command}.status.json")
    status = {"state": "running", "log": args.log, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if not args.dry_run:
        write_json(status_path, status)
    try:
        if args.command == "prepare":
            result = prepare(ctx, args.base, checkouts, args.jobs)
            line = result["text"]
        else:
            result = deploy(ctx, args.dry_run)
            if args.dry_run:
                return 0
            line = f"deployed {result['version']}; marker {result['markerCommit'][:7]} on {BRANCH}"
        write_json(status_path, {**status, "state": "done", "result": line,
                                 "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        notify(f"{args.command} done", [f"- {line}"], args.log or "(stdout)")
        return 0
    except Exception as e:
        ctx.say(f"FAILED: {e}")
        if not args.dry_run:
            write_json(status_path, {**status, "state": "failed", "error": str(e),
                                     "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            notify(f"{args.command} FAILED", [f"- {e}"], args.log or "(stdout)")
        return 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    sys.exit(main())
