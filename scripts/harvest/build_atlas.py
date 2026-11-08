"""Build the web landing's gallery atlas: the gallery's clips, small, in one looping video.

Usage:
    python3 -I scripts/harvest/build_atlas.py [--out build] [--feed feeds/demo.json] [--count 24]

Reads the feed and each clip's tile.mp4 (or 720.mp4) from the build made by
build_media.py, and writes, next to them:
    media/atlas/{hash}/atlas.mp4    every clip in a grid of cells, silent, looping seamlessly
    media/atlas/{hash}/atlas.jpg    its first frame, for before it plays (and for reduced motion)
    media/atlas/{hash}/atlas.json   the manifest the landing reads (src, grid, clip id per cell)

One stream and one decoder then play every tile on the landing at once (see
src/landing/AtlasPlayer.ts). The folder is named by a hash of its inputs, so
it's immutable like the rest of media/; serve its atlas.json at the address
the web build's EXPO_PUBLIC_GALLERY_ATLAS names (default /gallery-atlas/atlas.json).

The gallery shows the feed's first `--count` portrait clips, so build it from
the same feed, and rebuild it whenever that feed's head changes. Clips not in
the atlas still work: their tiles fall back to their own poster.
"""
import argparse
import hashlib
import json
import os
import subprocess
import tempfile


def probe(path: str) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
         "-of", "json", path], check=True, capture_output=True, text=True).stdout
    j = json.loads(out)
    s = j["streams"][0]
    return int(s["width"]), int(s["height"]), float(j["format"]["duration"])


def cell_filter(i: int, w: int, h: int, fps: int, loop: float, lead: float) -> str:
    """Clip i, cover-cropped to the cell, looping seamlessly: it plays lead..lead+loop,
    and its last `lead` seconds fade into its first, where the loop starts again."""
    end = loop + lead
    return (
        f"[{i}:v]fps={fps},scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h},"
        f"setsar=1,format=yuv420p,trim=0:{end},setpts=PTS-STARTPTS,split[a{i}][b{i}];"
        f"[a{i}]trim={lead}:{end},setpts=PTS-STARTPTS[m{i}];[b{i}]trim=0:{lead},setpts=PTS-STARTPTS[h{i}];"
        f"[m{i}][h{i}]xfade=transition=fade:duration={lead}:offset={loop - lead}[c{i}];"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build", help="the build_media.py output (R2 bucket layout)")
    ap.add_argument("--feed", default="feeds/demo.json")
    ap.add_argument("--count", type=int, default=24, help="clips in the atlas: the landing's GALLERY_SIZE")
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--cell", default="144x256", help="cell size; 9:16, about the tiles' size on screen")
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--loop", type=float, default=7, help="seconds; no longer than the shortest clip minus --lead")
    ap.add_argument("--lead", type=float, default=0.5)
    ap.add_argument("--crf", type=int, default=30)
    args = ap.parse_args()

    with open(os.path.join(args.out, args.feed)) as f:
        feed = json.load(f)
    cw, ch = (int(x) for x in args.cell.split("x"))

    clips = []
    for c in feed["clips"]:
        src = os.path.join(args.out, c.get("tile") or c["video"])
        w, h, dur = probe(src)
        # The gallery only shows portrait clips (WithLanding.web.tsx: toGallery).
        if c.get("width") and c.get("height") and c["width"] >= c["height"]:
            continue
        if dur < args.loop + args.lead:
            print(f"skip {c['id']}: {dur:.1f}s is shorter than the loop")
            continue
        clips.append((c["id"], src))
        if len(clips) == args.count:
            break
    if not clips:
        raise SystemExit("no clips for the atlas")

    cols = min(args.cols, len(clips))
    rows = -(-len(clips) // cols)
    inputs, graph, layout = [], "", []
    for i, (_, src) in enumerate(clips):
        inputs += ["-i", src]
        graph += cell_filter(i, cw, ch, args.fps, args.loop, args.lead)
        layout.append(f"{i % cols * cw}_{i // cols * ch}")
    # Empty cells (a short last row) are black.
    pad = rows * cols - len(clips)
    for k in range(pad):
        graph += f"color=black:s={cw}x{ch}:r={args.fps}:d={args.loop}[p{k}];"
        layout.append(f"{(len(clips) + k) % cols * cw}_{(len(clips) + k) // cols * ch}")
    graph += "".join(f"[c{i}]" for i in range(len(clips))) + "".join(f"[p{k}]" for k in range(pad))
    graph += f"xstack=inputs={len(clips) + pad}:layout={'|'.join(layout)}[out]"

    key = json.dumps([[i for i, _ in clips], args.cell, cols, args.fps, args.loop, args.lead, args.crf])
    folder = f"media/atlas/{hashlib.sha256(key.encode()).hexdigest()[:12]}"
    dest = os.path.join(args.out, folder)
    os.makedirs(dest, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "atlas.mp4")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-an",
             "-t", str(args.loop), "-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf),
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-frames:v", "1", "-q:v", "5",
                        os.path.join(tmp, "atlas.jpg")], check=True)
        for name in ("atlas.mp4", "atlas.jpg"):
            os.replace(os.path.join(tmp, name), os.path.join(dest, name))

    manifest = {
        "version": 1, "src": "atlas.mp4", "poster": "atlas.jpg", "cols": cols, "rows": rows,
        "cellW": cw, "cellH": ch, "fps": args.fps, "loop": args.loop, "lead": args.lead,
        "ids": [i for i, _ in clips],
    }
    with open(os.path.join(dest, "atlas.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    size = os.path.getsize(os.path.join(dest, "atlas.mp4"))
    print(f"{folder}: {len(clips)} clips, {cols}x{rows} cells of {args.cell}, {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
