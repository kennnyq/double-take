"""Pick real (not AI) comparison clips from the public X Community Notes dumps.

Usage:
    python3 -I scripts/harvest/pick_real.py NOTES(.zip|.tsv) STATUS(.zip|.tsv) OUT.jsonl
        [--exclude FILE.jsonl ...] [--ai FILE.jsonl ...] [--all-genres]

Same dumps as pick_notes.py. Writes two kinds of rows, both build_media.py candidates:

  negative  The noted post is real footage people took for AI: a helpful note says
            "this is not AI". Tier `real-verified`, or `not-ai-cgi` when the note says
            it's CGI, animation or a game (not AI, but not real footage either).
  pair      A helpful AI note links the original or real footage. The row's `url` is
            that link, and `pairOf` names the AI clip it pairs with. Many such links
            point at the AI creator's own upload, so check every one by eye.

`label` is always the feed-facing verdict ("real", or "not-ai-cgi", which the app
leaves unknown); `tier` says how we know. --ai files (the AI batches) only flag pairs
whose AI clip we already have, which are worth curating first. Notes on politics,
war, news, named people, sexual content or minors are skipped unless --all-genres
(the demo stays on harmless genres), and so are notes about film, music videos and
ads (real, but staged by named people).
"""
import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pick_notes import SKIP, excluded_ids, open_tsv  # noqa: E402

csv.field_size_limit(10**9)

# Feed `label` for each tier. The app maps a label to its verdict (feat/app-settings:
# verdictFromLabel in src/data/remote.ts): "real" → real, "confirmed" → AI, anything
# else → unknown. CGI is neither AI nor real footage, so it stays unknown on purpose.
LABEL_FOR_TIER = {
    "real-verified": "real",  # a helpful note or fact-check says it's real
    "real-prior": "real",     # uploaded before 2023, older than realistic text-to-video
    "real-agency": "real",    # from a channel that verifies footage before licensing it
    "real-consensus": "real",  # a clear "it's real" consensus on an is-this-AI subreddit
    "not-ai-cgi": "not-ai-cgi",  # CGI, animation or a game: not AI, not footage
}

# "This is not AI" in so many words. A looser "real footage" match catches mostly AI
# notes ("AI-generated, not real footage"), so an explicit negation is required.
NOT_AI = re.compile(
    r"\b((is|was|are|were) not (an? )?(ai|a\.i\.)|isn'?t (an? )?(ai|a\.i\.)|"
    r"not (ai|a\.i\.)[- ]generated|no (signs?|evidence|indication) of (ai|a\.i\.))",
    re.I,
)
AI_POS = re.compile(
    r"\b((is|are|was|appears to be|likely|probably) (an? )?(ai|a\.i\.)[- ]generated|"
    r"generated (by|with|using)|deepfake|sora|veo|kling|synthetic)\b",
    re.I,
)
# "The original video: <link>", "a real footage of the event is shown here". Needs a
# determiner or a sentence start, so "inconsistent with real footage" and "not real
# footage" (the usual AI-note phrasing) don't count.
ORIG = re.compile(
    r"(?:^|[.:!?]\s+|\b(?:the|an?|here'?s|here is|see|compare(?: with)?)\s+)"
    r"(original|real|actual|authentic|unedited|source) (video|footage|clip|upload)\b",
    re.I,
)
VIDEO = re.compile(r"\b(video|clip|footage|filmed)\b", re.I)
CGI = re.compile(r"\b(cgi|3d|animat\w*|blender|houdini|vfx|render\w*|game ?play|game footage|mods?)\b", re.I)
# Real, but staged and usually starring named people: not what the demo compares against.
STAGED = re.compile(r"\b(film|movie|music video|trailer|commercial|advert\w*|episode|bollywood|tv show)\b", re.I)
# Curation: harmless genres only.
OFF_GENRE = re.compile(
    r"\b(trump|biden|harris|obama|putin|netanyahu|zelensk\w*|israel\w*|gaza|palestin\w*|hamas|idf|"
    r"iran\w*|ukrain\w*|russia\w*|war|military|soldiers?|army|missiles?|bomb\w*|drone strike|"
    r"protest\w*|riot\w*|police|ice agents?|bodycam|arrest\w*|election\w*|president|minister|"
    r"government|politic\w*|candidate|senator|congress|propaganda|regime|terror\w*|shoot\w*|"
    r"killed|crash\w*|accident|dead|death|princess|prince|king|queen|influencer|"
    r"child(ren)?|kids?|students?|school|teens?|toddlers?|minors?)\b",
    re.I,
)
LINK = re.compile(r"https?://\S+")
VIDEO_LINK = re.compile(
    r"https?://(?:www\.|m\.|vm\.)?(?:youtube\.com/(?:watch\?v=|shorts/|live/)[\w-]{11}|youtu\.be/[\w-]{11}|"
    r"(?:x|twitter)\.com/\w+/status/\d+|tiktok\.com/\S+|instagram\.com/(?:reel|p)/[\w-]+)",
    re.I,
)
# Links that are never real footage of the subject.
NOT_FOOTAGE = re.compile(r"(?:x|twitter)\.com/grok\b|\bai\b|sora|kling|veo", re.I)


def cites_original(text: str) -> bool:
    """ORIG somewhere that isn't negated ("not a real clip from ...")."""
    return any(not text[max(0, m.start() - 4):m.start()].lower().endswith("not ") for m in ORIG.finditer(text))


def classify(text: str) -> str | None:
    """'negative', 'cgi', 'pair' or None for one note's text (genre not considered)."""
    if not VIDEO.search(text):
        return None
    if NOT_AI.search(text) and not AI_POS.search(text):
        return "cgi" if CGI.search(text) else "negative"
    if AI_POS.search(text) and cites_original(text) and real_links(text):
        return "pair"
    return None


def harmless(text: str) -> bool:
    return not (OFF_GENRE.search(text) or SKIP.search(text) or STAGED.search(text))


def real_links(text: str, own_id: str = "") -> list[str]:
    """Video links in a note that might be real footage, in order, without tracking junk
    and without links back to the noted post itself."""
    out = []
    for m in VIDEO_LINK.finditer(text):
        url = re.sub(r"[?&](si|s|t|igsh|igsi|ref)=[^&\s]*", "", m.group(0)).rstrip(".,)")
        url = url.replace("&amp;", "&")
        if own_id and url.endswith(f"/status/{own_id}"):
            continue
        if not NOT_FOOTAGE.search(url) and url not in out:
            out.append(url)
    return out


def tweet_url(tweet_id: str) -> str:
    return f"https://x.com/i/status/{tweet_id}"


def note_obj(n: dict) -> dict:
    ms = int(n["createdAtMillis"])
    return {
        "tweetId": n["tweetId"],
        "noteId": n["noteId"],
        "url": f"https://x.com/i/birdwatch/n/{n['noteId']}",
        "status": "CURRENTLY_RATED_HELPFUL",
        "createdAtMillis": ms,
        "text": n["summary"],
        "created": datetime.fromtimestamp(ms / 1000, timezone.utc).date().isoformat(),
    }


def rows_for(kind: str, n: dict, ours: set[str]) -> list[dict]:
    note = note_obj(n)
    if kind in ("negative", "cgi"):
        tier = "real-verified" if kind == "negative" else "not-ai-cgi"
        return [{
            "source": "community_notes",
            "kind": "negative",
            "url": tweet_url(n["tweetId"]),
            "label": LABEL_FOR_TIER[tier],
            "tier": tier,
            "evidence": n["summary"],
            "note": note,
        }]
    ai_id = f"x-{n['tweetId']}"
    return [{
        "source": "community_notes",
        "kind": "pair",
        "url": link,
        "label": LABEL_FOR_TIER["real-verified"],
        "tier": "real-verified",
        "evidence": n["summary"],
        "pairOf": ai_id,
        "realUrl": link,
        "how": "note-link",
        "pairInFeed": n["tweetId"] in ours,
        "note": note,
    } for link in real_links(n["summary"], n["tweetId"])]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("notes")
    ap.add_argument("status")
    ap.add_argument("out")
    ap.add_argument("--exclude", action="append", default=[], help="skip posts already in these JSONL files")
    ap.add_argument("--ai", action="append", default=[], help="AI batches: flag pairs whose AI clip we have")
    ap.add_argument("--all-genres", action="store_true", help="keep political, news and other off-genre notes")
    args = ap.parse_args()

    skip_ids = excluded_ids(args.exclude)
    ours = excluded_ids(args.ai)
    cands: dict[str, tuple[str, dict]] = {}
    with open_tsv(args.notes) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            kind = classify(row["summary"])
            if not kind or row["tweetId"] in skip_ids:
                continue
            if not args.all_genres and not harmless(row["summary"]):
                continue
            cands[row["noteId"]] = (kind, row)
    print(f"candidate notes: {len(cands)}", file=sys.stderr)

    helpful = []
    with open_tsv(args.status) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if row["noteId"] in cands and row.get("currentStatus") == "CURRENTLY_RATED_HELPFUL":
                helpful.append(cands[row["noteId"]])

    # One note per post (the newest), then pairs on our own clips first, then newest first.
    best: dict[tuple[str, str], tuple[str, dict]] = {}
    for kind, n in helpful:
        key = (kind, n["tweetId"])
        if key not in best or int(n["createdAtMillis"]) > int(best[key][1]["createdAtMillis"]):
            best[key] = (kind, n)
    rows = [r for kind, n in best.values() for r in rows_for(kind, n, ours)]
    rows.sort(key=lambda r: (not r.get("pairInFeed"), r["kind"] != "negative", -r["note"]["createdAtMillis"]))
    seen, out = set(), []
    for r in rows:
        if r["url"] not in seen:
            seen.add(r["url"])
            out.append(r)
    with open(args.out, "w") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    counts: dict[str, int] = {}
    for r in out:
        key = r["tier"] if r["kind"] == "negative" else "pair"
        counts[key] = counts.get(key, 0) + 1
    print(f"helpful: {len(helpful)}; wrote {len(out)} rows {counts} → {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
