"""Consensus verdict for a "is this AI?" thread: post flair plus score-weighted comments.

Pure functions, no network: pick_reddit.py feeds them Reddit's JSON, and
test_harvest.py feeds them fixtures.

    consensus(post, comments) -> {
        verdict: "ai" | "real" | "unsure", confidence: 0..1,
        ai: weight, real: weight, voters: n, flair, flairVerdict,
        evidence: [{stance, score, text, permalink}], tells: [{tell, count}],
    }

How a thread is scored:
  - Each comment gets a stance from what it says: "it's AI", "Sora", "AI slop" and
    "not real" read as AI; "not AI", "this is real", "the original video",
    "posted in 2019" read as real. A comment with both or neither has no stance.
  - A comment's weight is sqrt(score + 1), so a +400 comment counts about 20 times
    a +0 one rather than 400 times. A moderator's comment counts 5 times.
    Bots (AutoModerator) and deleted comments are ignored.
  - A verdict flair ("AI", "Not AI", "Confirmed AI"...) is set by the poster or the
    mods after the discussion. It weighs FLAIR_FACTOR times all comments together,
    and at least FLAIR_MIN: enough to settle a split thread, not enough to overturn
    a unanimous one (that comes out unsure).
  - CGI, animation and game footage is a third class: such comments don't vote.
  - margin = (ai - real) / (ai + real). The verdict is AI or real when |margin| is
    at least MIN_MARGIN and enough people weighed in (MIN_VOTERS stance comments,
    or a verdict flair); otherwise unsure. confidence = |margin|.
"""
import math
import re

FLAIR_MIN = 5.0
FLAIR_FACTOR = 1.5
MIN_MARGIN = 0.5
MIN_VOTERS = 3
MOD_WEIGHT = 5.0
BOTS = {"automoderator", "[deleted]", "isthisai-bot", "visualmod"}

# Flair text → verdict. Checked in order: "not ai" must win over "ai".
FLAIR = [
    (re.compile(r"\b(not|no|isn'?t)\s*(ai|a\.i\.)\b|\b(real|authentic|human[- ]made|genuine|legit)\b", re.I), "real"),
    (re.compile(r"\b(unsure|undetermined|unclear|inconclusive|unknown|unverified|discussion|edited|photoshop\w*)\b", re.I), None),
    (re.compile(r"\b(ai|a\.i\.|generated|deepfake|fake)\b", re.I), "ai"),
]

_NEG = r"(?:not|isn'?t|is not|ain'?t|wasn'?t|no way (?:it'?s|this is))"
AI_SAYS = re.compile(
    r"\b(?:"
    rf"{_NEG}\s+(?:a\s+)?(?:real|genuine|authentic)"  # "not real"
    r"|(?:it'?s|this is|that'?s|its|is|definitely|clearly|obviously|100%|totally|surely|def|absolutely)\s+(?:an?\s+)?(?:ai|a\.i\.|fake|generated)"
    r"|ai[- ]generated|ai slop|slop|made (?:with|by|using) ai|sora|veo ?\d?|kling|grok imagine|midjourney"
    r"|(?:screams|reeks of|looks like|smells like) ai"
    r")\b",
    re.I,
)
REAL_SAYS = re.compile(
    r"\b(?:"
    rf"{_NEG}\s+(?:an?\s+)?(?:ai|a\.i\.|generated|cgi)"  # "not AI"
    r"|(?:it'?s|this is|that'?s|its|is|definitely|100%|totally|looks|seems|absolutely)\s+(?:a\s+)?(?:real|legit|genuine|authentic)"
    r"|real (?:video|footage|clip|photo)|(?:original|source) (?:video|clip|footage|post|upload)"
    r"|(?:posted|uploaded|filmed|from|back in|in) (?:19\d\d|200\d|201\d|202[0-2])"
    r"|i (?:was there|know (?:this|the) (?:place|guy|person|video))|seen this (?:video )?(?:years|before)"
    r")\b",
    re.I,
)
# Concrete giveaways people cite (same spirit as pick_notes.TELLS, worded for comments).
TELLS = re.compile(
    r"\b(hands?|fingers?|legs?|arms?|feet|paws?|tail|faces?|eyes|teeth|text|letters|sign|logo|watermark|"
    r"license plate|physics|morph\w*|disappear\w*|vanish\w*|merg\w*|clipping|passes? through|shadows?|"
    r"reflections?|blur\w*|glitch\w*|flicker\w*|warp\w*|duplicat\w*|extra|floating|smooth\w*|"
    r"background|lighting|audio|sound|voice|loop\w*|10[- ]?seconds?|8[- ]?seconds?|cuts?)\b",
    re.I,
)
TELL_NORMAL = {"hand": "hands", "finger": "fingers", "leg": "legs", "arm": "arms", "paw": "paws", "face": "faces",
               "shadow": "shadows", "reflection": "reflections", "cut": "cuts", "second": "seconds"}


def flair_verdict(flair: str | None) -> str | None:
    if not flair:
        return None
    for pat, verdict in FLAIR:
        if pat.search(flair):
            return verdict
    return None


# One-word votes: "AI", "Real.", "100% AI", "fake", "legit".
VOTE_AI = re.compile(r"^\W*(?:100% |definitely |clearly |obviously )?(?:ai|a\.i\.|fake|ai slop|slop|generated)\W*$", re.I)
# A verdict up front: "AI - text on the sign...", "ai, extra fingers", "Real. I've been there".
LEAD_AI = re.compile(r"^\W*(?:ai|a\.i\.|fake)\s*[,.:;!\-–—]", re.I)
LEAD_REAL = re.compile(r"^\W*(?:real|not ai|legit)\s*[,.:;!\-–—]", re.I)
CGI = re.compile(r"\b(?:cgi|vfx|3d (?:render|animation|model)|animat(?:ed|ion)|blender|unreal engine|video ?game|gameplay)\b", re.I)
VOTE_REAL = re.compile(r"^\W*(?:100% |definitely |looks )?(?:real|legit|genuine|authentic|not ai)\W*$", re.I)


def stance(text: str) -> str | None:
    """'ai', 'real' or None for one comment."""
    t = (text or "").replace("’", "'")
    if CGI.search(t):
        return None
    if VOTE_REAL.match(t) or LEAD_REAL.match(t):
        return "real"
    if VOTE_AI.match(t) or LEAD_AI.match(t):
        return "ai"
    ai = len(AI_SAYS.findall(t))
    real = len(REAL_SAYS.findall(t))
    # "not real" is counted by AI_SAYS; make sure "not AI" doesn't also count as AI ("it's AI").
    if ai and real:
        return None if ai == real else ("ai" if ai > real else "real")
    return "ai" if ai else "real" if real else None


def weight(c: dict) -> float:
    w = math.sqrt(max(int(c.get("score") or 0), 0) + 1)
    return w * MOD_WEIGHT if c.get("distinguished") == "moderator" else w


def tells_in(texts: list[str]) -> list[dict]:
    counts: dict[str, int] = {}
    for t in texts:
        for hit in {m.group(0).lower() for m in TELLS.finditer(t)}:
            hit = TELL_NORMAL.get(hit, hit)
            counts[hit] = counts.get(hit, 0) + 1
    return [{"tell": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def clip(text: str, n: int = 280) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def consensus(post: dict, comments: list[dict], evidence_n: int = 3) -> dict:
    """Score one thread. `comments` is a flat list of Reddit comment `data` objects."""
    ai = real = 0.0
    voters = 0
    scored: list[tuple[str, dict]] = []
    for c in comments:
        if (c.get("author") or "").lower() in BOTS or c.get("body") in (None, "[deleted]", "[removed]"):
            continue
        if c.get("author") and c.get("author") == post.get("author"):
            continue  # the asker's own replies aren't votes
        s = stance(c["body"])
        if not s:
            continue
        voters += 1
        w = weight(c)
        if s == "ai":
            ai += w
        else:
            real += w
        scored.append((s, c))

    flair = post.get("link_flair_text")
    fv = flair_verdict(flair)
    if fv:
        boost = max(FLAIR_MIN, FLAIR_FACTOR * (ai + real))
        if fv == "ai":
            ai += boost
        else:
            real += boost

    total = ai + real
    margin = (ai - real) / total if total else 0.0
    enough = voters >= MIN_VOTERS or fv is not None
    verdict = ("ai" if margin > 0 else "real") if enough and abs(margin) >= MIN_MARGIN else "unsure"

    side = verdict if verdict != "unsure" else None
    support = sorted((c for s, c in scored if side is None or s == side), key=lambda c: -int(c.get("score") or 0))
    evidence = [{
        "stance": stance(c["body"]),
        "score": int(c.get("score") or 0),
        "text": clip(c["body"]),
        "permalink": f"https://www.reddit.com{c['permalink']}" if c.get("permalink") else None,
        **({"mod": True} if c.get("distinguished") == "moderator" else {}),
    } for c in support[:evidence_n]]
    ai_texts = [c["body"] for s, c in scored if s == "ai"]
    return {
        "verdict": verdict,
        "confidence": round(abs(margin), 3),
        "ai": round(ai, 2),
        "real": round(real, 2),
        "voters": voters,
        "flair": flair,
        "flairVerdict": fv,
        "evidence": evidence,
        "tells": tells_in(ai_texts)[:8] if verdict == "ai" else [],
    }


def flatten(listing: dict | list) -> list[dict]:
    """Every comment `data` in a Reddit comments listing, replies included."""
    out: list[dict] = []

    def walk(node):
        if isinstance(node, list):
            for n in node:
                walk(n)
        elif isinstance(node, dict):
            if node.get("kind") == "Listing":
                walk(node.get("data", {}).get("children", []))
            elif node.get("kind") == "t1":
                d = node.get("data", {})
                out.append(d)
                if isinstance(d.get("replies"), dict):
                    walk(d["replies"])
    walk(listing)
    return out


def summary(sub: str, c: dict) -> str:
    """Evidence text in the same spirit as a Community Note: the verdict and its best support."""
    head = f"r/{sub} consensus: {'AI' if c['verdict'] == 'ai' else c['verdict']} ({c['confidence']:.2f}, {c['voters']} votes"
    head += f", flair \"{c['flair']}\")" if c.get("flair") else ")"
    quotes = " ".join(f"\"{e['text']}\" (+{e['score']})" for e in c["evidence"])
    tells = ", ".join(t["tell"] for t in c.get("tells", [])[:5])
    return f"{head}. {quotes}" + (f" Tells cited: {tells}." if tells else "")
