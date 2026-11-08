"""Probe ranked candidates in rank order and keep the ones worth building.

Usage:
    python3 -I scripts/harvest/resolve.py RANKED.jsonl LIVE.jsonl [N] [--min 3] [--max 90]

Reads rows with a `url` (pick_notes.py, pick_real.py or search_real.py output) and
asks yt-dlp for each post's metadata, without downloading media. A row is kept when:
  - the post is live and has a single video (deleted posts, suspended accounts,
    image-only and multi-video posts are skipped);
  - the video runs MIN to MAX seconds (default 3 to 90);
  - its media id hasn't been seen yet. yt-dlp gives every repost of an X video the
    same media id, so the first (best-ranked) post wins and reposts are dropped.
Stops after N keepers (default: all). Kept rows get a `probe` object with the
metadata later steps need (duration, size, uploader, title, upload date, media id).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

# X thumbnails carry the media id; every repost of a video shares it.
MEDIA_ID = re.compile(r"/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)/(\d+)/")


def probe(url: str, timeout: int = 90) -> dict | None:
    """Metadata for a post's single video, or None when it's gone or not one video."""
    try:
        out = subprocess.run(
            ["yt-dlp", "-J", "--no-warnings", "--no-playlist", "--skip-download", url],
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    info = json.loads(out.stdout)
    if info.get("_type") == "playlist":
        entries = [e for e in info.get("entries") or [] if e]
        if len(entries) != 1:
            return None
        info = {**info, **entries[0]}
    if not info.get("duration") or info.get("vcodec") == "none":
        return None
    return summarize(info)


def media_id(info: dict) -> str:
    for t in [info.get("thumbnail")] + [t.get("url") for t in info.get("thumbnails") or []]:
        m = MEDIA_ID.search(t or "")
        if m:
            return m.group(1)
    return f"{info.get('extractor_key', '?')}:{info.get('id')}"


def summarize(info: dict) -> dict:
    return {
        "duration": round(float(info["duration"]), 2),
        "width": info.get("width"),
        "height": info.get("height"),
        "uploader": info.get("uploader") or info.get("channel"),
        "channel": info.get("channel") or info.get("uploader"),
        "title": info.get("title"),
        "uploadDate": info.get("upload_date"),
        "views": info.get("view_count"),
        "likes": info.get("like_count"),
        "mediaId": media_id(info),
        "thumbnail": info.get("thumbnail"),
    }


def keep(p: dict | None, seen: set[str], lo: float, hi: float) -> str | None:
    """None when the probe passes; otherwise the reason it was dropped."""
    if p is None:
        return "gone or not a single video"
    if not lo <= p["duration"] <= hi:
        return f"{p['duration']}s outside {lo:g}-{hi:g}s"
    if p["mediaId"] in seen:
        return f"repost of media {p['mediaId']}"
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ranked")
    ap.add_argument("out")
    ap.add_argument("n", nargs="?", type=int, default=0, help="stop after this many keepers (0: all)")
    ap.add_argument("--min", type=float, default=3)
    ap.add_argument("--max", type=float, default=90)
    args = ap.parse_args()

    with open(args.ranked) as f:
        rows = [json.loads(line) for line in f if line.strip()]
    seen: set[str] = set()
    kept = probed = 0
    with open(args.out, "w") as f:
        for row in rows:
            if args.n and kept >= args.n:
                break
            probed += 1
            p = probe(row["url"])
            why = keep(p, seen, args.min, args.max)
            if why:
                print(f"drop {row['url']}: {why}", file=sys.stderr)
                continue
            seen.add(p["mediaId"])
            kept += 1
            print(f"keep {row['url']}: {p['duration']}s {p['uploader']!r}", file=sys.stderr)
            f.write(json.dumps({**row, "probe": p}, ensure_ascii=False) + "\n")
            f.flush()
    print(f"kept {kept} of {probed} probed → {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
