"""Download candidate videos, archive the originals and build servable media plus a feed.

Usage:
    python3 -I scripts/harvest/build_media.py CANDIDATES.jsonl [--out build] [--max-duration 90] [--merge]

--merge keeps the existing feed and only downloads candidates it doesn't have yet,
so adding clips never drops one whose source link has since died.

CANDIDATES.jsonl rows need at least `url`; `label`, `evidence`, `views`, `likes`,
`uploader` and `source` are carried into the feed when present.

Output mirrors the R2 bucket layout:
    archive/{sha256}/original.<ext>, info.json, candidate.json   private, never served
    media/{clipId}/v1/720.mp4, poster.jpg, tells.<hash>.json    immutable, served
    media/{clipId}/v1/tile.mp4                                  small silent copy for the web landing's gallery
    feeds/demo.json                                             the feed
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


def clip_id(url: str) -> str:
    m = re.search(r"(?:x|twitter)\.com/.*/status/(\d+)", url)
    if m:
        return f"x-{m.group(1)}"
    m = re.search(r"(?:youtube\.com/(?:watch\?v=|shorts/)|youtu\.be/)([\w-]{11})", url)
    if m:
        return f"yt-{m.group(1)}"
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
    s = d["streams"][0]
    return {"width": s["width"], "height": s["height"], "duration": round(float(d["format"]["duration"]), 2)}


def download(url: str, tmp: str) -> tuple[str, dict]:
    subprocess.run(
        ["yt-dlp", "-q", "--no-warnings", "--no-playlist", "--write-info-json",
         "-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
         "-o", os.path.join(tmp, "original.%(ext)s"), url],
        check=True, capture_output=True, text=True, timeout=600)
    media = [f for f in os.listdir(tmp) if f.startswith("original.") and not f.endswith(".json")]
    if not media:
        raise RuntimeError("yt-dlp produced no media file")
    with open(os.path.join(tmp, "original.info.json")) as f:
        info = json.load(f)
    return os.path.join(tmp, media[0]), info


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
            src, info = download(url, tmp)
        except Exception as e:  # dead links are expected; skip them
            print(f"skip {cid}: download failed ({str(e).splitlines()[0][:120]})", file=sys.stderr)
            return None
        meta = probe(src)
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
        "source": {
            "url": url,
            "platform": cid.split("-")[0],
            "author": info.get("uploader") or cand.get("uploader"),
            "title": info.get("title"),
            "views": info.get("view_count") or cand.get("views"),
            "likes": info.get("like_count") or cand.get("likes"),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates")
    ap.add_argument("--out", default="build")
    ap.add_argument("--max-duration", type=float, default=90)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--merge", action="store_true", help="keep the existing feed; only add new clips")
    args = ap.parse_args()

    with open(args.candidates) as f:
        cands = [json.loads(line) for line in f if line.strip()]
    # One clip per id: the same post can appear twice in a candidate list.
    uniq = list({clip_id(c["url"]): c for c in cands}.values())
    feed_path = os.path.join(args.out, "feeds", "demo.json")
    existing = []
    if args.merge and os.path.exists(feed_path):
        with open(feed_path) as f:
            existing = json.load(f)["clips"]
        have = {c["id"] for c in existing}
        uniq = [c for c in uniq if clip_id(c["url"]) not in have]
        print(f"merge: {len(existing)} clips kept, {len(uniq)} new to build", file=sys.stderr)
    with ThreadPoolExecutor(args.jobs) as ex:
        clips = existing + [c for c in ex.map(lambda c: build_one(c, args.out, args.max_duration), uniq) if c]

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
    print(f"feed: {len(feed)} clips → {os.path.join(args.out, 'feeds', 'demo.json')}", file=sys.stderr)


if __name__ == "__main__":
    main()
