"""Download candidate videos, archive the originals and build servable media plus a feed.

Usage:
    python3 -I scripts/harvest/build_media.py CANDIDATES.jsonl [--out build] [--max-duration 90] [--merge]
        [--feed demo] [--exclude-discarded [--decisions DECISIONS.jsonl]]

--merge keeps the existing feed and only downloads candidates it doesn't have yet,
so adding clips never drops one whose source link has since died.
--feed NAME writes feeds/NAME.json (default demo); the Worker serves it at
/feed?name=NAME. Media is shared: a clip already built for another feed is reused.
--exclude-discarded leaves out every clip the review site marked discard
(scripts/harvest/review/decisions.jsonl, or --decisions PATH; see REVIEW.md), from
the new candidates and, with --merge, from the kept feed too. In a pair feed
(--feed other than demo, e.g. compare) a discarded clip also takes its pair with
it: real clips paired with a discarded AI clip go, and an AI clip whose real
partners were all discarded goes.

CANDIDATES.jsonl rows need at least `url`; `label`, `evidence`, `views`, `likes`,
`uploader` and `source` are carried into the feed when present, and so are the
comparison fields `tier` (how we know a real clip is real), `pairOf` (the AI clip
id it compares with) and `how`. `download` fetches media from another URL than
`url`, the clip's identity (a Reddit thread whose video is on v.redd.it); `title`
and `uploader` then stand in for what that URL can't say. `section` ("MM:SS-MM:SS") cuts a long source,
such as a livestream, down to that stretch before anything else.

Output mirrors the R2 bucket layout:
    archive/{sha256}/original.<ext>, info.json, candidate.json   private, never served
    media/{clipId}/v1/720.mp4, poster.jpg, tells.<hash>.json    immutable, served
    media/{clipId}/v1/tile.mp4                                  small silent copy for the web landing's gallery
    feeds/<name>.json                                           the feed (demo by default)
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
TELLS_DIR = os.path.join(HERE, "tells")
# Alternative pipelines' tells (dev-build comparison), one folder per variant.
VARIANTS_DIR = os.path.join(HERE, "..", "annotate", "variants")
VERSION = "v1"
# Carried from a candidate row into its feed row when present.
COMPARE_FIELDS = ("tier", "pairOf", "how")


def clip_id(url: str) -> str:
    m = re.search(r"(?:x|twitter)\.com/.*/status/(\d+)", url)
    if m:
        return f"x-{m.group(1)}"
    m = re.search(r"(?:youtube\.com/(?:watch\?v=|shorts/)|youtu\.be/)([\w-]{11})", url)
    if m:
        return f"yt-{m.group(1)}"
    m = re.search(r"reddit\.com/r/\w+/comments/(\w+)", url)
    if m:
        return f"rd-{m.group(1)}"
    return "u-" + hashlib.sha256(url.encode()).hexdigest()[:16]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    if not d.get("streams"):
        raise RuntimeError(f"no video stream in {os.path.basename(path)}")
    s = d["streams"][0]
    return {"width": s["width"], "height": s["height"], "duration": round(float(d["format"]["duration"]), 2)}


def fetch(url: str, tmp: str, section: str | None) -> tuple[str, dict]:
    cut = ["--download-sections", f"*{section}", "--force-keyframes-at-cuts"] if section else []
    subprocess.run(
        ["yt-dlp", "-q", "--no-warnings", "--no-playlist", "--write-info-json", *cut,
         "-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
         "-o", os.path.join(tmp, "original.%(ext)s"), url],
        check=True, capture_output=True, text=True, timeout=600)
    media = [f for f in os.listdir(tmp) if f.startswith("original.") and not f.endswith(".json")]
    if not media:
        raise RuntimeError("yt-dlp produced no media file")
    with open(os.path.join(tmp, "original.info.json")) as f:
        info = json.load(f)
    return os.path.join(tmp, media[0]), info


def download(url: str, tmp: str, section: str | None = None) -> tuple[str, dict]:
    """Download a post's video, cut to `section` ("MM:SS-MM:SS") when given. yt-dlp
    cuts YouTube streams itself, but its cut of X's CDN comes back empty; then the
    whole post is downloaded and cut here."""
    src, info = fetch(url, tmp, section)
    if not section:
        return src, info
    try:
        probe(src)
        return src, info
    except Exception:
        for f in os.listdir(tmp):
            os.remove(os.path.join(tmp, f))
    full, info = fetch(url, tmp, None)
    start, end = section.split("-", 1)
    cut = os.path.join(tmp, "original.cut.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", start, "-to", end, "-i", full, "-c:v", "libx264",
                    "-preset", "fast", "-crf", "16", "-c:a", "aac", "-b:a", "192k", cut], check=True)
    return cut, info


def normalize(src: str, dst_dir: str) -> None:
    os.makedirs(dst_dir, exist_ok=True)
    # Long side 1280, aspect kept (portrait 720x1280, landscape 1280x720).
    scale = "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)':flags=lanczos"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", scale, "-r", "30",
         "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "2500k", "-bufsize", "5000k",
         "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", "30",
         "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart",
         os.path.join(dst_dir, "720.mp4")], check=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", "0.5", "-i", os.path.join(dst_dir, "720.mp4"),
         "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),640,360)':-2", "-q:v", "5",
         os.path.join(dst_dir, "poster.jpg")], check=True)


def make_tile(media_dir: str) -> None:
    """A small, silent copy for the web landing's gallery, where dozens play at
    once: long side 480 (portrait 270x480), no audio, the first 12 seconds."""
    scale = "scale='if(gt(iw,ih),480,-2)':'if(gt(iw,ih),-2,480)':flags=lanczos"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", os.path.join(media_dir, "720.mp4"), "-t", "12", "-vf", scale,
         "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", os.path.join(media_dir, "tile.mp4")], check=True)


def attach_tile(clip: dict, out: str) -> None:
    """Point a feed clip at its tile, making the tile first if it is missing."""
    media_dir = os.path.join(out, os.path.dirname(clip["video"]))
    if not os.path.exists(os.path.join(media_dir, "tile.mp4")):
        make_tile(media_dir)
    clip["tile"] = f"{os.path.dirname(clip['video'])}/tile.mp4"


def copy_tells(cid: str, out: str, src_dir: str = TELLS_DIR) -> str | None:
    """Copy <src_dir>/<cid>.json to a content-addressed name (same as
    scripts/annotate: sha256 of the file bytes). Media is cached for a day under a
    URL that only changes daily, so new tells need a new name, not an overwrite."""
    src = os.path.join(src_dir, f"{cid}.json")
    if not os.path.exists(src):
        return None
    with open(src, "rb") as f:
        data = f.read()
    # Like scripts/annotate: a file with only unplaced claims still ships (the "Also noted" card).
    parsed = json.loads(data)
    if not parsed.get("tells") and not parsed.get("unplaced"):
        return None
    key = f"media/{cid}/{VERSION}/tells.{hashlib.sha256(data).hexdigest()[:12]}.json"
    os.makedirs(os.path.dirname(os.path.join(out, key)), exist_ok=True)
    with open(os.path.join(out, key), "wb") as f:
        f.write(data)
    return key


def attach_tells(clip: dict, out: str) -> None:
    """Point a feed clip at its current tells and alternative tells from the repo."""
    cid = clip["id"]
    clip["tells"] = copy_tells(cid, out)
    alt = {}
    if os.path.isdir(VARIANTS_DIR):
        for variant in sorted(os.listdir(VARIANTS_DIR)):
            key = copy_tells(cid, out, os.path.join(VARIANTS_DIR, variant))
            if key:
                alt[variant] = key
    if alt:
        clip["tellsAlt"] = alt
    else:
        clip.pop("tellsAlt", None)


def build_one(cand: dict, out: str, max_duration: float) -> dict | None:
    url = cand["url"]
    cid = clip_id(url)
    media_dir = os.path.join(out, "media", cid, VERSION)
    with tempfile.TemporaryDirectory() as tmp:
        try:
            src, info = download(cand.get("download") or url, tmp, cand.get("section"))
            meta = probe(src)
        except Exception as e:  # dead links are expected; skip them
            print(f"skip {cid}: download failed ({(str(e).splitlines() or [repr(e)])[0][:120]})", file=sys.stderr)
            return None
        if meta["duration"] > max_duration:
            print(f"skip {cid}: {meta['duration']}s is longer than {max_duration}s", file=sys.stderr)
            return None
        digest = sha256(src)
        arch = os.path.join(out, "archive", digest)
        os.makedirs(arch, exist_ok=True)
        shutil.copy(src, os.path.join(arch, "original" + os.path.splitext(src)[1]))
        with open(os.path.join(arch, "info.json"), "w") as f:
            json.dump(info, f, ensure_ascii=False)
        with open(os.path.join(arch, "candidate.json"), "w") as f:
            json.dump(cand, f, ensure_ascii=False, indent=2)
        normalize(src, media_dir)

    served = probe(os.path.join(media_dir, "720.mp4"))
    tells_key = copy_tells(cid, out)
    base = f"media/{cid}/{VERSION}"
    print(f"ok   {cid}: {served['width']}x{served['height']} {served['duration']}s"
          f"{' +tells' if tells_key else ''}", file=sys.stderr)
    return {
        "id": cid,
        "video": f"{base}/720.mp4",
        "poster": f"{base}/poster.jpg",
        "tells": tells_key,
        **served,
        "sha256": digest,
        "label": cand.get("label"),
        "evidence": cand.get("evidence"),
        **{k: cand[k] for k in COMPARE_FIELDS if cand.get(k)},
        "source": {
            "url": url,
            "platform": cid.split("-")[0],
            "author": (cand.get("uploader") if cand.get("download") else None) or info.get("uploader") or cand.get("uploader"),
            "title": (cand.get("title") if cand.get("download") else None) or info.get("title"),
            "views": info.get("view_count") or cand.get("views"),
            "likes": info.get("like_count") or cand.get("likes"),
        },
    }


def built_elsewhere(out: str, feed_name: str) -> dict[str, dict]:
    """Rows of clips already built into the other feeds under `out`, by id, when their
    media is still on disk. Published media is never re-encoded in place."""
    rows: dict[str, dict] = {}
    feeds_dir = os.path.join(out, "feeds")
    if not os.path.isdir(feeds_dir):
        return rows
    for name in sorted(os.listdir(feeds_dir)):
        if not name.endswith(".json") or name == f"{feed_name}.json":
            continue
        with open(os.path.join(feeds_dir, name)) as f:
            for c in json.load(f).get("clips", []):
                if c["id"] not in rows and os.path.exists(os.path.join(out, c["video"])):
                    rows[c["id"]] = c
    return rows


def reuse(row: dict, cand: dict) -> dict:
    """Another feed's row for this clip, with this candidate's label, evidence and
    comparison fields (an AI clip can be a plain demo clip and a compare partner)."""
    out = {k: v for k, v in row.items() if k not in COMPARE_FIELDS}
    for k in ("label", "evidence"):
        if cand.get(k):
            out[k] = cand[k]
    out.update({k: cand[k] for k in COMPARE_FIELDS if cand.get(k)})
    print(f"use  {row['id']}: already built for another feed", file=sys.stderr)
    return out


def drop_discarded(rows: list[dict], gone: set[str], pairs: bool = False) -> list[dict]:
    """Rows (candidates or feed rows) without the clips the review discarded. With
    `pairs`, a pair feed: rows paired with a discarded clip go too, and so does a
    clip that was paired with but has no partner left."""
    rid = lambda r: r["id"] if "id" in r else clip_id(r["url"])  # noqa: E731
    out = [r for r in rows if rid(r) not in gone]
    if pairs:
        out = [r for r in out if r.get("pairOf") not in gone]
        had = {r["pairOf"] for r in rows if r.get("pairOf")}
        has = {r["pairOf"] for r in out if r.get("pairOf")}
        out = [r for r in out if rid(r) not in had or rid(r) in has]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates")
    ap.add_argument("--out", default="build")
    ap.add_argument("--max-duration", type=float, default=90)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--merge", action="store_true", help="keep the existing feed; only add new clips")
    ap.add_argument("--feed", default="demo", help="feed name: writes feeds/NAME.json (default demo)")
    ap.add_argument("--exclude-discarded", action="store_true", help="leave out clips the review marked discard")
    ap.add_argument("--decisions", help="the review's decisions file (default: review/decisions.jsonl)")
    args = ap.parse_args()
    if not re.fullmatch(r"[\w-]+", args.feed):
        ap.error("--feed takes letters, digits, _ and - (the Worker's rule)")

    with open(args.candidates) as f:
        cands = [json.loads(line) for line in f if line.strip()]
    # One clip per id: the same post can appear twice in a candidate list.
    uniq = list({clip_id(c["url"]): c for c in cands}.values())
    feed_path = os.path.join(args.out, "feeds", f"{args.feed}.json")
    existing = []
    if args.merge and os.path.exists(feed_path):
        with open(feed_path) as f:
            existing = json.load(f)["clips"]
        have = {c["id"] for c in existing}
        uniq = [c for c in uniq if clip_id(c["url"]) not in have]
        print(f"merge: {len(existing)} clips kept, {len(uniq)} new to build", file=sys.stderr)
    if args.exclude_discarded:
        sys.path.insert(0, HERE)  # -I leaves the script's folder off the path
        import review
        gone = review.discarded(args.decisions or review.DECISIONS)
        pairs = args.feed != "demo"
        # Prune over the whole feed, so a pair spanning kept and new rows is judged as one.
        kept = drop_discarded(existing + uniq, gone, pairs)
        ids = {id(r) for r in kept}
        dropped = len(existing) + len(uniq) - len(kept)
        existing = [r for r in existing if id(r) in ids]
        uniq = [r for r in uniq if id(r) in ids]
        print(f"review: {dropped} row(s) left out ({len(gone)} discarded clip(s))", file=sys.stderr)
    elsewhere = built_elsewhere(args.out, args.feed)

    def build_or_reuse(c: dict) -> dict | None:
        row = elsewhere.get(clip_id(c["url"]))
        return reuse(row, c) if row else build_one(c, args.out, args.max_duration)

    with ThreadPoolExecutor(args.jobs) as ex:
        clips = existing + [c for c in ex.map(build_or_reuse, uniq) if c]

    # Collapse re-uploads of byte-identical files.
    seen, feed = set(), []
    for c in clips:
        if c["sha256"] not in seen:
            seen.add(c["sha256"])
            feed.append(c)
    # Refresh tells for every clip, kept ones included, so --merge also picks up tells changes.
    for c in feed:
        attach_tells(c, args.out)
    # Tiles too, so --merge also makes them for clips built before tiles existed.
    with ThreadPoolExecutor(args.jobs) as ex:
        list(ex.map(lambda c: attach_tile(c, args.out), feed))
    os.makedirs(os.path.join(args.out, "feeds"), exist_ok=True)
    with open(feed_path, "w") as f:
        json.dump({"version": 1, "clips": feed}, f, ensure_ascii=False, indent=2)
    print(f"feed: {len(feed)} clips → {feed_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
