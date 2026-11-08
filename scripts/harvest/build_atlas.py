"""Build the web landing's gallery atlas: the gallery's clips, small, in one looping video.

Usage:
    python3 -I scripts/harvest/build_atlas.py [--out build] [--feed feeds/demo.json] [--count 24]

Reads the feed and each clip's tile.mp4 (or 720.mp4) from the build made by
build_media.py, and writes, next to them:
    media/atlas/{hash}/atlas.mp4    every clip in a grid of cells, silent, a fragmented MP4 that loops without a seam
    media/atlas/{hash}/atlas.jpg    its first frame, for before it plays (and for reduced motion)
    media/atlas/{hash}/atlas.json   the manifest the landing reads (src, grid, clip id per cell)

One stream and one decoder then play every tile on the landing at once (see
src/landing/AtlasPlayer.ts). Nothing in it ever cuts: each cell closes its loop
on an eased dissolve, counted in whole frames, at its own moment (`phases`),
and the player appends the file to itself endlessly (atlasStream.ts). The folder is named by a hash of its inputs, so
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


def avc1_codec(path: str) -> str:
    """The RFC 6381 codec string (avc1.PPCCLL) from the file's avcC box."""
    with open(path, "rb") as f:
        data = f.read(4096)
    at = data.find(b"avcC")
    if at < 0:
        raise SystemExit("no avcC in the atlas")
    profile, compat, level = data[at + 5], data[at + 6], data[at + 7]
    return f"avc1.{profile:02x}{compat:02x}{level:02x}"


def phase(i: int, n: int) -> int:
    """Where cell i's loop starts, in frames: spread by the golden ratio, so no two
    neighbours (and never all at once) cross their loop's dissolve together."""
    return round((i * 0.6180339887) % 1 * n) % n


def cell_filter(i: int, w: int, h: int, fps: int, n: int, k: int, p: int) -> str:
    """Clip i, cover-cropped to the cell, as a loop of n frames that never cuts.

    Counted in frames, not seconds, so nothing lands half a frame off: the loop
    plays the clip's frames k..k+n-1, and its last k frames dissolve into the
    clip's frames 0..k-1, which lead straight into frame k where it began. Then
    it is rotated to start p frames in, so cells loop at different moments.
    """
    # Every frame stamped with its index in a 1/fps timebase, so xstack pairs the
    # cells' frames one to one (with mixed timebases it repeated frame 1 and dropped the last).
    to_frames = f"settb=1/{fps},setpts=N"
    g = (
        f"[{i}:v]fps={fps},scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h},"
        f"setsar=1,format=yuv420p,trim=end_frame={n + k},{to_frames},split[a{i}][b{i}];"
        f"[a{i}]trim=start_frame={k},{to_frames}[m{i}];[b{i}]trim=end_frame={k},{to_frames}[h{i}];"
        # Eased (smoothstep), so the dissolve starts and ends with the smallest of steps.
        f"[m{i}][h{i}]xfade=transition=custom:expr='A*P*P*(3-2*P)+B*(1-P*P*(3-2*P))'"
        f":duration={k / fps}:offset={(n - k) / fps},{to_frames}"
    )
    if p == 0:
        return g + f"[c{i}];"
    return (
        g + f",split[r{i}][s{i}];[r{i}]trim=start_frame={p},{to_frames}[x{i}];[s{i}]trim=end_frame={p},{to_frames}[y{i}];"
        f"[x{i}][y{i}]concat=n=2:v=1:a=0,{to_frames}[c{i}];"
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
    ap.add_argument("--lead", type=float, default=0.5, help="seconds of dissolve where each clip's loop closes")
    ap.add_argument("--crf", type=int, default=32)
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

    # Whole frames, so the loop closes exactly.
    n = round(args.loop * args.fps)
    k = max(1, round(args.lead * args.fps))
    loop = n / args.fps
    phases = [phase(i, n) for i in range(len(clips))]
    cols = min(args.cols, len(clips))
    rows = -(-len(clips) // cols)
    inputs, graph, layout = [], "", []
    for i, (_, src) in enumerate(clips):
        inputs += ["-i", src]
        graph += cell_filter(i, cw, ch, args.fps, n, k, phases[i])
        layout.append(f"{i % cols * cw}_{i // cols * ch}")
    # Empty cells (a short last row) are black.
    pad = rows * cols - len(clips)
    for j in range(pad):
        graph += f"color=black:s={cw}x{ch}:r={args.fps}:d={loop}[p{j}];"
        layout.append(f"{(len(clips) + j) % cols * cw}_{(len(clips) + j) // cols * ch}")
    graph += "".join(f"[c{i}]" for i in range(len(clips))) + "".join(f"[p{j}]" for j in range(pad))
    graph += f"xstack=inputs={len(clips) + pad}:layout={'|'.join(layout)}[out]"

    key = json.dumps([[i for i, _ in clips], args.cell, cols, args.fps, n, k, phases, args.crf, "fmp4"])
    folder = f"media/atlas/{hashlib.sha256(key.encode()).hexdigest()[:12]}"
    dest = os.path.join(args.out, folder)
    os.makedirs(dest, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        video = os.path.join(tmp, "atlas.mp4")
        # One keyframe, at the start, and no B-frames: the player appends this same
        # fragment again and again to one Media Source timeline (AtlasPlayer.ts), so
        # it plays on forever without the stall a <video loop> has as it wraps.
        # The keyframe and the last frames before it get finer quantizers: otherwise
        # the keyframe repaints every tile's compression noise as it comes round
        # again, a twitch across the whole wall (4.6x a normal step on a still tile,
        # 1.9x with these).
        zones = f"0,0,q=18/{n - 10},{n - 1},q=20"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-an",
             "-frames:v", str(n), "-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf), "-bf", "0",
             "-x264-params", f"keyint={n}:min-keyint={n}:scenecut=0:zones={zones}", "-pix_fmt", "yuv420p",
             "-movflags", "+frag_keyframe+empty_moov+default_base_moof", video], check=True)
        codec = avc1_codec(video)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-frames:v", "1", "-q:v", "3",
                        os.path.join(tmp, "atlas.jpg")], check=True)
        for name in ("atlas.mp4", "atlas.jpg"):
            os.replace(os.path.join(tmp, name), os.path.join(dest, name))

    manifest = {
        "version": 1, "src": "atlas.mp4", "poster": "atlas.jpg", "cols": cols, "rows": rows,
        # For MediaSource.isTypeSupported / addSourceBuffer.
        "mime": f'video/mp4; codecs="{codec}"',
        "cellW": cw, "cellH": ch, "fps": args.fps, "loop": loop, "lead": k / args.fps,
        "ids": [i for i, _ in clips],
        # Where each cell's loop starts, in seconds into it.
        "phases": [p / args.fps for p in phases],
    }
    with open(os.path.join(dest, "atlas.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    size = os.path.getsize(os.path.join(dest, "atlas.mp4"))
    print(f"{folder}: {len(clips)} clips, {cols}x{rows} cells of {args.cell}, {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
