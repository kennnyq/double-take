"""Pick AI-video candidates from the public X Community Notes dumps.

Usage:
    python3 -I scripts/harvest/pick_notes.py NOTES(.zip|.tsv) STATUS(.zip|.tsv) OUT.jsonl
        [--exclude FILE.jsonl ...] [--limit 400]

The dumps are published daily at
    https://ton.twimg.com/birdwatch-public-data/YYYY/MM/DD/notes/notes-00000.zip
    https://ton.twimg.com/birdwatch-public-data/YYYY/MM/DD/noteStatusHistory/noteStatusHistory-00000.zip
and are read straight out of the zip, without extracting.

Keeps notes that are currently rated helpful, say the post's video is AI-generated,
and aren't about clips listed in --exclude files (any JSONL with `url` or `tweetId`).
Ranks notes that name concrete tells (hands, text, physics, timestamps...) above
templated ones. Each output row is a build_media.py candidate plus the note, in the
shape scripts/annotate/notes.jsonl uses.
"""
import argparse
import csv
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timezone

csv.field_size_limit(10**9)

AI = re.compile(
    r"\b(ai[- ]generated|a\.i\.? generated|generated (by|with|using) (ai|sora|veo|kling|seedance)|"
    r"sora|veo ?[234]?|kling|seedance|deepfake|synthetic video|made (with|using) ai|created (with|using|by) ai)\b",
    re.I,
)
VIDEO = re.compile(r"\b(video|clip|footage)\b", re.I)
# Concrete, checkable giveaways. Each distinct hit adds to the score.
TELLS = re.compile(
    r"\b(hands?|fingers?|legs?|arms?|feet|paws?|tail|faces?|eyes|teeth|mouth|lips?|text|letters|sign|logo|"
    r"watermark|license|plate|physics|morph\w*|disappear\w*|vanish\w*|appear\w*|merg\w*|passes? through|"
    r"shadow|reflection|blur\w*|glitch\w*|flicker\w*|warp\w*|duplicat\w*|extra|missing|floating|"
    r"10[- ]?second|8[- ]?second|0:\d\d|\d+ ?seconds? in)\b",
    re.I,
)
# Boilerplate a few note writers paste on every AI clip; it names no specific tell.
TEMPLATE = re.compile(r"telltale signs of ai|depicts telltale signs|no (verified|authentic|verifiable) (records?|source)", re.I)
SKIP = re.compile(r"\b(nude|nudity|naked|sexual|porn\w*|explicit|undress\w*|minor)\b", re.I)


def open_tsv(path: str) -> io.TextIOBase:
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        member = next(n for n in z.namelist() if n.endswith(".tsv"))
        return io.TextIOWrapper(z.open(member), encoding="utf-8", newline="")
    return open(path, newline="", encoding="utf-8")


def excluded_ids(paths: list[str]) -> set[str]:
    ids: set[str] = set()
    for p in paths:
        with open(p) as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("tweetId"):
                    ids.add(str(row["tweetId"]))
                m = re.search(r"/status/(\d+)", row.get("url", ""))
                if m:
                    ids.add(m.group(1))
    return ids


def score(text: str) -> int:
    hits = {m.group(0).lower() for m in TELLS.finditer(text)}
    return len(hits) - (3 if TEMPLATE.search(text) else 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("notes")
    ap.add_argument("status")
    ap.add_argument("out")
    ap.add_argument("--exclude", action="append", default=[])
    ap.add_argument("--limit", type=int, default=400)
    args = ap.parse_args()

    skip_ids = excluded_ids(args.exclude)
    cands: dict[str, dict] = {}
    with open_tsv(args.notes) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            text = row["summary"]
            if not row["classification"].startswith("MISINFORMED"):
                continue
            if not (AI.search(text) and VIDEO.search(text)) or SKIP.search(text):
                continue
            if row["tweetId"] in skip_ids:
                continue
            cands[row["noteId"]] = row
    print(f"AI-video notes: {len(cands)}", file=sys.stderr)

    helpful: dict[str, dict] = {}
    with open_tsv(args.status) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if row["noteId"] in cands and row.get("currentStatus") == "CURRENTLY_RATED_HELPFUL":
                helpful[row["noteId"]] = cands[row["noteId"]]
    print(f"rated helpful: {len(helpful)}", file=sys.stderr)

    # One note per post: keep the most specific.
    best: dict[str, dict] = {}
    for n in helpful.values():
        cur = best.get(n["tweetId"])
        if cur is None or score(n["summary"]) > score(cur["summary"]):
            best[n["tweetId"]] = n

    ranked = sorted(best.values(), key=lambda n: (-score(n["summary"]), -int(n["createdAtMillis"])))[: args.limit]
    with open(args.out, "w") as f:
        for n in ranked:
            f.write(json.dumps({
                "source": "community_notes",
                "url": f"https://x.com/i/status/{n['tweetId']}",
                "label": "confirmed",
                "evidence": n["summary"],
                "score": score(n["summary"]),
                "note": {
                    "tweetId": n["tweetId"],
                    "noteId": n["noteId"],
                    "url": f"https://x.com/i/birdwatch/n/{n['noteId']}",
                    "status": "CURRENTLY_RATED_HELPFUL",
                    "createdAtMillis": int(n["createdAtMillis"]),
                    "text": n["summary"],
                    "created": datetime.fromtimestamp(int(n["createdAtMillis"]) / 1000, timezone.utc).date().isoformat(),
                },
            }, ensure_ascii=False) + "\n")
    print(f"wrote {len(ranked)} ranked candidates → {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
