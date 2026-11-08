"""Find clips that are the same footage under two ids, and pick which copy to keep.

    python3 -I scripts/harvest/dedupe.py BUILD/feeds/demo.json [--root BUILD] [--json] [--cache FILE]

Read-only: it reads the feed and each clip's served 720.mp4 and prints the pairs it
would drop. build_media.py runs the same step on every build (--no-dedupe skips it).

Two clips are duplicates when any of these hold:
  - same file (sha256) or same source URL;
  - same footage: a 64-bit difference hash (dHash, 9x8 grey) of one frame per second.
    Lined up at the best constant time offset, at least MIN_SHARE of the shorter clip's
    frames are within MAX_BITS bits of the other clip's (±1 s), and they cover at least
    MIN_LONG of the longer clip. Order matters, so look-alike frames from different
    videos don't add up. Survives re-encodes, resizes and trims; a heavy crop or an
    added caption bar can hide a duplicate.
A short clip found inside a much longer, different one (a compilation) is reported as
an overlap for a person to judge, never dropped.
Frames are compared only for clips that share a 16-bit band of some frame hash, so a
feed of a few hundred clips takes seconds once the hashes are computed.

Of each duplicate group, the copy kept is the better annotated one: it has main tells,
then more alternative tells, then the higher resolution, then the earlier feed position.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict

MAX_BITS = 14      # frames this close (of 64 bits) look the same
MIN_SHARE = 0.5    # share of the shorter clip's frames that must line up
MIN_LONG = 0.25    # ...covering at least this share of the longer clip (else: overlap)
MIN_FRAMES = 3     # clips shorter than this (in sampled frames) are only matched exactly


def dhash_frames(video: str, fps: float = 1.0) -> list[int]:
    """One 64-bit dHash per sampled frame: each pixel brighter than its right neighbour."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={fps},scale=9:8:flags=area,format=gray",
         "-f", "rawvideo", "-"],
        capture_output=True, check=True, timeout=300).stdout
    hashes = []
    for i in range(0, len(out) - 71, 72):
        px = out[i:i + 72]
        h = 0
        for row in range(8):
            for col in range(8):
                h = (h << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
        # Skip flat frames (black, white, a single colour): they match everything.
        if h not in (0, (1 << 64) - 1):
            hashes.append(h)
    return hashes


def bits(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def share(a: list[int], b: list[int]) -> tuple[float, float]:
    """(share of the shorter clip, share of the longer clip) of frames that match when the
    two are lined up at their best constant offset; a frame may match its neighbour ±1."""
    if min(len(a), len(b)) < MIN_FRAMES:
        return 0.0, 0.0
    best = 0
    for off in range(-len(b) + 1, len(a)):
        n = 0
        for i in range(max(0, off), min(len(a), len(b) + off)):
            j = i - off
            if any(bits(a[i], b[k]) <= MAX_BITS for k in (j - 1, j, j + 1) if 0 <= k < len(b)):
                n += 1
        best = max(best, n)
    return best / min(len(a), len(b)), best / max(len(a), len(b))


def rank(c: dict, index: int) -> tuple:
    """Lower is better: annotated first, then sharper, then earlier in the feed."""
    return (not c.get("tells"), -len(c.get("tellsAlt") or {}), -(c.get("width", 0) * c.get("height", 0)), index)


def source_url(c: dict) -> str | None:
    src = c.get("source") or {}
    return (src.get("url") if isinstance(src, dict) else None) or None


def find_duplicates(clips: list[dict], frames: dict[str, list[int]], overlaps: list | None = None) -> list[dict]:
    """Duplicate groups as [{keep, drop: [{id, why, share?}]}], in feed order. Overlaps
    (a short clip inside a longer, different one) are appended to `overlaps` if given."""
    n = len(clips)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    why: dict[tuple[int, int], dict] = {}

    def link(i: int, j: int, reason: dict) -> None:
        a, b = sorted((i, j))
        why.setdefault((a, b), reason)
        parent[find(a)] = find(b)

    # Exact: same file or same source post.
    for key, label in ((lambda c: c.get("sha256"), "same file"), (source_url, "same source URL")):
        seen: dict[str, int] = {}
        for i, c in enumerate(clips):
            k = key(c)
            if not k:
                continue
            if k in seen:
                link(seen[k], i, {"why": label})
            else:
                seen[k] = i

    # Footage: candidates share a 16-bit band of some frame hash, then a full comparison.
    bands: dict[tuple[int, int], set[int]] = defaultdict(set)
    for i, c in enumerate(clips):
        for h in frames.get(c["id"], []):
            for b in range(4):
                bands[(b, (h >> (16 * b)) & 0xFFFF)].add(i)
    cands = set()
    for members in bands.values():
        if 1 < len(members) <= 50:  # a band shared by many clips is a common pattern, not a match
            ms = sorted(members)
            cands.update((a, b) for k, a in enumerate(ms) for b in ms[k + 1:])
    for a, b in sorted(cands):
        if find(a) == find(b):
            continue
        short, long_ = share(frames.get(clips[a]["id"], []), frames.get(clips[b]["id"], []))
        if short < MIN_SHARE:
            continue
        if long_ >= MIN_LONG:
            link(a, b, {"why": "same footage", "share": round(short, 2)})
        elif overlaps is not None:
            overlaps.append({"a": clips[a]["id"], "b": clips[b]["id"], "short": round(short, 2), "long": round(long_, 2)})

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    out = []
    for members in groups.values():
        if len(members) < 2:
            continue
        keep = min(members, key=lambda i: rank(clips[i], i))
        drops = []
        for i in sorted(members):
            if i == keep:
                continue
            pair = tuple(sorted((i, keep)))
            reason = why.get(pair) or next((why[p] for p in why if i in p), {"why": "same group"})
            drops.append({"id": clips[i]["id"], **reason})
        out.append({"keep": clips[keep]["id"], "drop": drops, "first": min(members)})
    out.sort(key=lambda g: g["first"])
    for g in out:
        g.pop("first")
    return out


def load_frames(clips: list[dict], root: str, cache_path: str | None = None) -> dict[str, list[int]]:
    """dHash frames per clip id from each clip's served video, with an optional cache file
    (keyed by id and the video's sha256, so a re-encode is hashed again)."""
    cache: dict[str, dict] = {}
    if cache_path and os.path.exists(cache_path):
        with open(cache_path) as f:
            cache = json.load(f)
    frames: dict[str, list[int]] = {}
    for c in clips:
        key = f"{c['id']}:{c.get('sha256', '')}"
        if key in cache:
            frames[c["id"]] = [int(h, 16) for h in cache[key]]
            continue
        video = os.path.join(root, c["video"])
        if not os.path.exists(video):
            print(f"dedupe: {c['id']}: no video at {video}; matched by file and URL only", file=sys.stderr)
            continue
        try:
            frames[c["id"]] = dhash_frames(video)
        except (subprocess.SubprocessError, OSError) as e:
            print(f"dedupe: {c['id']}: couldn't read frames ({e})", file=sys.stderr)
            continue
        cache[key] = [f"{h:016x}" for h in frames[c["id"]]]
    if cache_path:
        os.makedirs(os.path.dirname(os.path.abspath(cache_path)), exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(cache, f)
    return frames


def dedupe(clips: list[dict], root: str, cache_path: str | None = None,
           overlaps: list | None = None) -> tuple[list[dict], list[dict]]:
    """(clips without duplicates, duplicate groups). `pairOf` pointing at a dropped clip
    is repointed at the copy kept. Overlaps go to `overlaps` if given."""
    groups = find_duplicates(clips, load_frames(clips, root, cache_path), overlaps)
    to_keep = {d["id"]: g["keep"] for g in groups for d in g["drop"]}
    out = []
    for c in clips:
        if c["id"] in to_keep:
            continue
        if c.get("pairOf") in to_keep:
            c = {**c, "pairOf": to_keep[c["pairOf"]]}
        out.append(c)
    return out, groups


def describe(groups: list[dict], clips: list[dict], overlaps: list | None = None) -> str:
    by = {c["id"]: c for c in clips}

    def what(cid: str) -> str:
        c = by.get(cid, {})
        tells = "tells" if c.get("tells") else "no tells"
        alt = f"+{len(c['tellsAlt'])} alt" if c.get("tellsAlt") else ""
        return f"{cid} ({c.get('width')}x{c.get('height')} {c.get('duration')}s, {tells}{(' ' + alt) if alt else ''})"

    lines = []
    for g in groups:
        lines.append(f"keep {what(g['keep'])}")
        for d in g["drop"]:
            extra = f", {d['share']:.0%} of frames" if "share" in d else ""
            lines.append(f"  drop {what(d['id'])}: {d['why']}{extra}")
    n = sum(len(g["drop"]) for g in groups)
    lines.append(f"{len(groups)} duplicate group(s); {n} clip(s) would be dropped of {len(clips)}")
    for o in overlaps or []:
        lines.append(f"overlap (not dropped; check by eye): {what(o['a'])} and {what(o['b'])}: "
                     f"{o['short']:.0%} of the shorter, {o['long']:.0%} of the longer")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("feed", help="a built feed, e.g. build/feeds/demo.json")
    ap.add_argument("--root", help="the build folder the feed's media paths are under (default: the feed's ../..)")
    ap.add_argument("--cache", help="frame-hash cache file to read and write (default: none, nothing written)")
    ap.add_argument("--json", action="store_true", help="print the groups as JSON")
    args = ap.parse_args()
    root = args.root or os.path.dirname(os.path.dirname(os.path.abspath(args.feed)))
    with open(args.feed) as f:
        clips = json.load(f)["clips"]
    overlaps: list = []
    _, groups = dedupe(clips, root, args.cache, overlaps)
    print(json.dumps({"groups": groups, "overlaps": overlaps}, indent=2) if args.json
          else describe(groups, clips, overlaps))


if __name__ == "__main__":
    main()
