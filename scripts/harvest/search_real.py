"""Find real lookalike footage for AI clips that have no note linking the original.

Usage:
    python3 -I scripts/harvest/search_real.py AI.jsonl OUT.jsonl
        [--per-clip 2] [--hits 10] [--query CLIPID=TEXT ...]

AI.jsonl rows need a `url`; a `query`, `title` or `evidence` helps. For each AI clip:
  1. Subject query: the row's `query`, a --query override, or 3-6 words picked from the
     post's title and note by `subject_query` (a keyword heuristic; a local text model
     could replace it later). Rows with no usable subject are skipped.
  2. `ytsearchN:<query>` (flat, ~1.6 s), then a full probe of each hit (3-5 s) for its
     upload date, channel and duration.
  3. Keep hits 3-90 s long that are either uploaded before 2023 (tier `real-prior`:
     older than realistic text-to-video) or from a licensing channel that verifies
     footage before buying it (tier `real-agency`). Titles that mention AI, CGI,
     animation or off-genre subjects are dropped.
  4. Rank by word overlap between the query and the hit's title; keep the best
     --per-clip rows, each with `pairOf` set to the AI clip's id.
Output rows are build_media.py candidates (label "real", plus tier and evidence).
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_media import clip_id  # noqa: E402
from pick_real import LABEL_FOR_TIER, OFF_GENRE  # noqa: E402
from resolve import probe  # noqa: E402

# Channels that check footage before licensing it (names as YouTube shows them).
LICENSING = re.compile(
    r"\b(viralhog|storyful|newsflare|jukin\w*|failarmy|petsami|the pet collective|caters|ringtv|"
    r"rumble ?viral|viral ?press|ap archive|reuters)\b",
    re.I,
)
SYNTHETIC = re.compile(r"\b(ai|a\.i\.|sora|veo|kling|generated|cgi|3d|animat\w*|render\w*|cartoon|game|minecraft|roblox)\b", re.I)
PRIOR_CUTOFF = "20230101"

STOP = set("""
a an the and or but if of to in on at by for with from into onto over under up down out off is are was were be been
being this that these those it its it's he she they them his her their you your we our i me my just so very really
not no yes too also than then when what who how why where which while about after before again all any some more most
other such only own same can will would should could do does did done has have had get got gets watch look see video
clip footage moment moments viral new now today day time way like one two first last even ever never still here there
gonna wanna literally actually omg wow bro guys man woman people person someone thing things lol lmao insane crazy
generated generate created made using real fake shows show shown note notes post posted posts account x twitter
""".split())
# Concrete, searchable subjects get picked first.
SUBJECT = re.compile(
    r"\b(dogs?|puppy|puppies|cats?|kittens?|bears?|deer|goats?|sheep|cows?|horses?|pigs?|alpacas?|llamas?|camels?|"
    r"elephants?|lions?|tigers?|leopards?|wolf|wolves|fox(es)?|monkeys?|gorillas?|birds?|eagles?|hawks?|owls?|"
    r"parrots?|ducks?|geese|goose|penguins?|sharks?|whales?|dolphins?|octopus|fish|snakes?|python|lizards?|"
    r"alligators?|crocodiles?|turtles?|frogs?|kangaroos?|squirrels?|raccoons?|otters?|hippos?|rhinos?|giraffes?|"
    r"zebras?|moose|bison|buffalo|storm|tornado|hurricane|lightning|flood|waves?|tsunami|snow|avalanche|volcano|"
    r"rain|hail|wind|fire|cliff|mountain|river|ocean|beach|car|truck|bus|train|plane|boat|bike|bicycle|"
    r"motorcycle|scooter|robot|rocket|drone|skateboard|surf\w*|ski\w*|parkour|jump\w*|stunt|climb\w*|"
    r"cooking|food|bbq|pizza|cake|chef|pothole|crash|rescue\w*|nail|clippers?|cannon|tshirt|t-shirt)\b",
    re.I,
)
WORD = re.compile(r"[a-z][a-z'-]+")


def clean(text: str) -> str:
    text = re.sub(r"https?://\S+|[@#]\w+|&\w+;", " ", text or "")
    return text.replace("’", "'")


def subject_query(title: str | None, evidence: str | None = None, author: str | None = None, max_words: int = 5) -> str:
    """A short search query for what the clip shows: subject nouns first (from the post,
    then the note), then other content words from the post, in their original order."""
    title = clean(title or "")
    if author and title.startswith(f"{author} - "):
        title = title[len(author) + 3:]
    note = clean(evidence or "")
    words: list[str] = []

    def add(w: str) -> None:
        w = w.strip("'-").lower()
        if len(w) > 2 and w not in STOP and w not in words and not SYNTHETIC.fullmatch(w):
            words.append(w)

    for src in (title, note):
        for m in SUBJECT.finditer(src):
            add(m.group(0))
    if not words:
        return ""
    for w in WORD.findall(title.lower()):
        if len(words) >= max_words:
            break
        add(w)
    return " ".join(words[:max_words])


def overlap(query: str, title: str) -> float:
    """Share of the query's words (stems, roughly) found in the hit's title."""
    q = {w.rstrip("s") for w in WORD.findall(query.lower()) if w not in STOP}
    t = {w.rstrip("s") for w in WORD.findall((title or "").lower())}
    return len(q & t) / len(q) if q else 0.0


def search(query: str, hits: int) -> list[dict]:
    out = subprocess.run(
        ["yt-dlp", "--flat-playlist", "-J", "--no-warnings", f"ytsearch{hits}:{query}"],
        capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        return []
    return [e for e in json.loads(out.stdout).get("entries") or [] if e and e.get("id")]


def tier_for(p: dict) -> str | None:
    if (p.get("uploadDate") or "99999999") < PRIOR_CUTOFF:
        return "real-prior"
    if LICENSING.search(f"{p.get('channel') or ''} {p.get('uploader') or ''}"):
        return "real-agency"
    return None


def evidence_for(p: dict, tier: str, query: str, ai_id: str) -> str:
    d = p.get("uploadDate") or ""
    date = f"{d[:4]}-{d[4:6]}-{d[6:]}" if len(d) == 8 else "an unknown date"
    who = p.get("channel") or p.get("uploader") or "an unknown channel"
    why = ("before realistic text-to-video existed" if tier == "real-prior"
           else "a licensing channel that verifies footage before buying it")
    return (f"Uploaded {date} by {who}: {why}. Found by searching \"{query}\" "
            f"as real footage to compare with {ai_id}.")


def candidates_for(row: dict, query: str, hits: int, lo: float, hi: float) -> list[dict]:
    ai_id = clip_id(row["url"])
    found = []
    for e in search(query, hits):
        title = e.get("title") or ""
        if SYNTHETIC.search(title) or OFF_GENRE.search(title):
            continue
        if e.get("duration") and not lo <= e["duration"] <= hi:
            continue  # flat results often know the length already; skip the probe
        url = f"https://www.youtube.com/watch?v={e['id']}"
        p = probe(url)
        if not p or not lo <= p["duration"] <= hi:
            continue
        tier = tier_for(p)
        if not tier:
            continue
        found.append({
            "source": "ytsearch",
            "kind": "lookalike",
            "url": url,
            "label": LABEL_FOR_TIER[tier],
            "tier": tier,
            "evidence": evidence_for(p, tier, query, ai_id),
            "pairOf": ai_id,
            "how": "subject-search",
            "query": query,
            "score": round(overlap(query, p.get("title") or title), 3),
            "probe": p,
        })
    found.sort(key=lambda r: -r["score"])
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ai")
    ap.add_argument("out")
    ap.add_argument("--per-clip", type=int, default=2)
    ap.add_argument("--hits", type=int, default=10)
    ap.add_argument("--min", type=float, default=3)
    ap.add_argument("--max", type=float, default=90)
    ap.add_argument("--query", action="append", default=[], metavar="CLIPID=TEXT", help="override a clip's query")
    args = ap.parse_args()

    overrides = dict(q.split("=", 1) for q in args.query)
    with open(args.ai) as f:
        rows = [json.loads(line) for line in f if line.strip()]
    seen: set[str] = set()
    with open(args.out, "w") as f:
        for row in rows:
            ai_id = clip_id(row["url"])
            query = overrides.get(ai_id) or row.get("query") or subject_query(
                row.get("title") or (row.get("probe") or {}).get("title"), row.get("evidence"),
                row.get("uploader") or (row.get("probe") or {}).get("uploader"))
            if not query:
                print(f"skip {ai_id}: no subject to search for", file=sys.stderr)
                continue
            kept = 0
            for c in candidates_for(row, query, args.hits, args.min, args.max):
                if kept >= args.per_clip or c["url"] in seen:
                    continue
                seen.add(c["url"])
                kept += 1
                f.write(json.dumps(c, ensure_ascii=False) + "\n")
                f.flush()
            print(f"{ai_id}: \"{query}\" → {kept} kept", file=sys.stderr)


if __name__ == "__main__":
    main()
