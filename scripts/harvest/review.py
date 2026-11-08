"""Read the clip review's decisions (scripts/harvest/review/decisions.jsonl).

The review site (npm run review, scripts/review/) appends one event per change; this
folds them the same way it does (scripts/review/decisions.ts): set events apply in
(at, id) order, later fields win, and an undo event cancels its target.

    python3 -I scripts/harvest/review.py                    # counts per status
    python3 -I scripts/harvest/review.py --status needs-work
    python3 -I scripts/harvest/review.py --status discard --json
    python3 -I scripts/harvest/review.py --picks             # annotations marked as good tells, with notes

build_media.py --exclude-discarded uses `discarded()` to leave those clips out, and
--only-kept uses `kept()` to build only clips the review marked keep.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DECISIONS = os.path.join(HERE, "review", "decisions.jsonl")
STATUSES = ("keep", "discard", "needs-work")


def read_events(path: str = DECISIONS) -> list[dict]:
    """Events in the log, skipping blank, malformed and conflict-marker lines."""
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(e, dict) or not all(isinstance(e.get(k), str) for k in ("id", "key", "at")):
                continue
            if isinstance(e.get("undo"), str) or isinstance(e.get("set"), dict):
                out.append(e)
    return out


def merge_tells(cur: dict[str, dict], patch: dict) -> dict[str, dict]:
    """Per-annotation marks (`tells`, keyed "<run>/<tell id>"): fields merge, None clears,
    and a mark left with no pick and no note goes. Same as decisions.ts mergeTells."""
    out = dict(cur)
    for ref, m in patch.items():
        if not isinstance(m, dict):
            out.pop(ref, None)
            continue
        prev = out.get(ref, {"pick": False, "note": ""})
        nxt = {"pick": m["pick"] if isinstance(m.get("pick"), bool) else prev["pick"],
               "note": m["note"] if isinstance(m.get("note"), str) else prev["note"]}
        if nxt["pick"] or nxt["note"]:
            out[ref] = nxt
        else:
            out.pop(ref, None)
    return out


def fold(events: list[dict]) -> dict[str, dict]:
    """Current state per clip key: status (None = unreviewed), tags, note, tells, url, by, at, events.
    Only `status` decides what the feed build keeps; `tells` marks are for the annotation work."""
    undone = {e["undo"] for e in events if isinstance(e.get("undo"), str)}
    live = sorted((e for e in events if isinstance(e.get("set"), dict) and e["id"] not in undone),
                  key=lambda e: (e["at"], e["id"]))
    states: dict[str, dict] = {}
    for e in live:
        s = states.setdefault(e["key"], {"key": e["key"], "status": None, "tags": [], "note": "", "tells": {},
                                         "by": e.get("by"), "at": e["at"], "events": 0})
        patch = e["set"]
        if "status" in patch and (patch["status"] is None or patch["status"] in STATUSES):
            s["status"] = patch["status"]
        if isinstance(patch.get("tags"), list):
            s["tags"] = list(dict.fromkeys(t for t in patch["tags"] if isinstance(t, str)))
        if isinstance(patch.get("note"), str):
            s["note"] = patch["note"]
        if isinstance(patch.get("tells"), dict):
            s["tells"] = merge_tells(s["tells"], patch["tells"])
        if e.get("url"):
            s["url"] = e["url"]
        s["by"], s["at"] = e.get("by"), e["at"]
        s["events"] += 1
    return states


def load(path: str = DECISIONS) -> dict[str, dict]:
    return fold(read_events(path))


def discarded(path: str = DECISIONS) -> set[str]:
    """Clip keys (build_media.clip_id) currently marked discard."""
    return {k for k, s in load(path).items() if s["status"] == "discard"}


def kept(path: str = DECISIONS) -> set[str]:
    """Clip keys (build_media.clip_id) currently marked keep."""
    return {k for k, s in load(path).items() if s["status"] == "keep"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--decisions", default=DECISIONS)
    ap.add_argument("--status", choices=(*STATUSES, "any"), help="list clips with this status")
    ap.add_argument("--tag", help="only clips with this tag")
    ap.add_argument("--json", action="store_true", help="one JSON state per line")
    ap.add_argument("--picks", action="store_true", help="list marked annotations (picks and notes)")
    args = ap.parse_args()

    states = load(args.decisions)
    if args.picks:
        n = 0
        for s in sorted(states.values(), key=lambda s: s["key"]):
            for ref, m in sorted(s["tells"].items()):
                n += 1
                if args.json:
                    print(json.dumps({"key": s["key"], "tell": ref, **m}, ensure_ascii=False))
                else:
                    print(f"{s['key']}  {ref}  {'★' if m['pick'] else ' '}  {m['note']}".rstrip())
        print(f"{n} marked annotation(s)", file=sys.stderr)
        return
    if not args.status and not args.tag:
        counts: dict[str, int] = {}
        for s in states.values():
            counts[s["status"] or "unreviewed"] = counts.get(s["status"] or "unreviewed", 0) + 1
        print(f"{len(states)} clips with decisions in {os.path.relpath(args.decisions)}")
        for k in (*STATUSES, "unreviewed"):
            if counts.get(k):
                print(f"  {k:<11} {counts[k]}")
        return
    rows = [s for s in states.values()
            if (args.status in (None, "any") or s["status"] == args.status)
            and (not args.tag or args.tag in s["tags"])]
    rows.sort(key=lambda s: s["at"])
    for s in rows:
        if args.json:
            print(json.dumps(s, ensure_ascii=False))
        else:
            extra = "  [" + ", ".join(s["tags"]) + "]" if s["tags"] else ""
            print(f"{s['key']}  {s['status'] or '-'}  {s.get('url', '')}{extra}")
            if s["note"]:
                print("    " + s["note"].replace("\n", "\n    "))
    print(f"{len(rows)} clip(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
