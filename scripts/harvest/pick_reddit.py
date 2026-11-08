"""Harvest AI and real video clips from "is this AI?" subreddits, with the thread's consensus.

Usage:
    python3 -I scripts/harvest/pick_reddit.py OUT.jsonl --creds FILE [--sub isthisAI ...]
        [--listing top:year --listing top:all --listing new] [--pages 5] [--cache DIR]
        [--min-confidence 0.6] [--all-genres] [--exclude FILE.jsonl ...]
    python3 -I scripts/harvest/pick_reddit.py OUT.jsonl --offline --cache DIR   # re-score saved JSON
    python3 -I scripts/harvest/pick_reddit.py OUT.jsonl --public --fetch-only --cache DIR   # see below

Reddit blocks unauthenticated JSON from many networks ("blocked by network
security"), so this reads the API with app-only OAuth: a "script" app's
client_id:client_secret in FILE (or REDDIT_CREDENTIALS_FILE), client_credentials
grant, read-only, no Reddit account password. Requests are spaced at least 1.1 s
apart and follow Reddit's X-Ratelimit headers. Every raw response is saved under
--cache, so --offline re-scores without touching the network.

Where Reddit doesn't block the network (a home connection, say), --public reads the
public JSON endpoints instead, with no credentials, at the same pace and into the
same cache. --fetch-only stops after filling the cache (listings, plus the comment
trees of video posts that pass curation). Copy that cache to the harvest machine
and run --offline there.

For each video post (Reddit-hosted, or linking X / YouTube / TikTok / Instagram):
  - curation: no NSFW, removed posts, or off-genre titles (pick_real.OFF_GENRE);
  - consensus.py scores flair and comments; only clear verdicts are kept
    (--min-confidence, default 0.6);
  - media: Reddit-hosted video downloads from its v.redd.it HLS playlist (the CDN
    needs no login, unlike yt-dlp's Reddit extractor); linked posts are probed with
    yt-dlp. Both must run 3-90 s.
Rows are build_media.py candidates: `url` is the clip's identity (the linked post,
or the Reddit thread for Reddit-hosted video), `download` the media to fetch.
AI → label "confirmed"; real → label "real", tier "real-consensus".
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_media import clip_id  # noqa: E402
from consensus import consensus, flatten, summary  # noqa: E402
from pick_notes import SKIP, excluded_ids  # noqa: E402
from pick_real import LABEL_FOR_TIER, OFF_GENRE  # noqa: E402

# Generic client name, per Reddit's API rules: <platform>:<app id>:<version> (by ...).
USER_AGENT = "linux:double-take-harvest:0.2 (research script for a media literacy demo)"
LINKED = re.compile(
    r"https?://(?:www\.|m\.|vm\.|mobile\.)?(?:(?:x|twitter)\.com/\w+/status/\d+|youtube\.com/(?:watch\?v=|shorts/)[\w-]{11}|"
    r"youtu\.be/[\w-]{11}|tiktok\.com/\S+|instagram\.com/(?:reel|p)/[\w-]+)",
    re.I,
)
VREDDIT = re.compile(r"https?://v\.redd\.it/(\w+)")


class Reddit:
    """Tiny OAuth client: app-only token, polite pacing, raw responses cached."""

    def __init__(self, creds_file: str | None, cache: str, offline: bool = False, min_gap: float = 1.1,
                 public: bool = False):
        self.cache, self.offline, self.min_gap, self.public = cache, offline, min_gap, public
        self.token: str | None = None
        self.last = 0.0
        self.creds_file = creds_file
        os.makedirs(cache, exist_ok=True)

    def _auth(self) -> str:
        if self.token:
            return self.token
        if not self.creds_file or not os.path.exists(self.creds_file):
            raise SystemExit("no Reddit credentials: pass --creds FILE (client_id:client_secret) or use --offline")
        with open(self.creds_file) as f:
            cid, secret = f.read().strip().split(":", 1)
        req = urllib.request.Request(
            "https://www.reddit.com/api/v1/access_token",
            data=b"grant_type=client_credentials",
            headers={"User-Agent": USER_AGENT,
                     "Authorization": "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode()})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.load(r)
        if "access_token" not in body:
            raise SystemExit(f"Reddit token request failed: {body.get('error', body)}")
        self.token = body["access_token"]
        return self.token

    def get(self, path: str, **params) -> dict | list:
        key = re.sub(r"[^\w.-]+", "_", path.strip("/") + ("?" + urllib.parse.urlencode(sorted(params.items())) if params else ""))
        cached = os.path.join(self.cache, key + ".json")
        if os.path.exists(cached):
            with open(cached) as f:
                return json.load(f)
        if self.offline:
            raise FileNotFoundError(cached)
        query = urllib.parse.urlencode({**params, "raw_json": 1})
        url = f"https://www.reddit.com{path}.json?{query}" if self.public else f"https://oauth.reddit.com{path}?{query}"
        for attempt in range(4):
            wait = self.min_gap - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            auth = {} if self.public else {"Authorization": f"Bearer {self._auth()}"}
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **auth})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = json.load(r)
                    remaining = float(r.headers.get("X-Ratelimit-Remaining") or 100)
                    reset = float(r.headers.get("X-Ratelimit-Reset") or 0)
                    if remaining < 5 and reset:
                        time.sleep(reset + 1)
                break
            except urllib.error.HTTPError as e:
                if e.code == 401 and attempt == 0 and not self.public:
                    self.token = None  # expired token: fetch a new one
                    continue
                if e.code in (429, 500, 502, 503) and attempt < 3:
                    time.sleep(2 ** (attempt + 2))
                    continue
                raise
        with open(cached, "w") as f:
            json.dump(body, f)
        return body


def media_of(post: dict) -> dict | None:
    """Where a post's video lives: {url, download?, duration?, hosted} or None (image, text...)."""
    for p in [post] + list(post.get("crosspost_parent_list") or []):
        rv = ((p.get("secure_media") or p.get("media") or {}) or {}).get("reddit_video")
        if rv:
            m = VREDDIT.search(p.get("url_overridden_by_dest") or p.get("url") or "")
            base = f"https://v.redd.it/{m.group(1)}" if m else None
            hls = rv.get("hls_url") or (f"{base}/HLSPlaylist.m3u8" if base else None)
            if not hls:
                continue
            return {"url": f"https://www.reddit.com{post['permalink']}", "download": hls.split("?")[0],
                    "duration": rv.get("duration"), "hosted": True}
        link = p.get("url_overridden_by_dest") or p.get("url") or ""
        m = LINKED.search(link) or LINKED.search(p.get("selftext") or "")
        if m:
            return {"url": m.group(0), "hosted": False}
    return None


def skip_reason(post: dict, all_genres: bool) -> str | None:
    if post.get("over_18"):
        return "nsfw"
    if post.get("removed_by_category") or post.get("removed_by"):
        return "removed"
    text = f"{post.get('title', '')} {post.get('selftext', '')}"
    if SKIP.search(text):
        return "sexual or minors"
    if not all_genres and OFF_GENRE.search(text):
        return "off-genre"
    return None


def row_for(sub: str, post: dict, media: dict, c: dict) -> dict:
    real = c["verdict"] == "real"
    row = {
        "source": "reddit",
        "url": media["url"],
        **({"download": media["download"]} if media.get("download") else {}),
        "label": LABEL_FOR_TIER["real-consensus"] if real else "confirmed",
        **({"tier": "real-consensus"} if real else {}),
        "how": "reddit-consensus",
        "evidence": summary(sub, c),
        "title": post.get("title"),
        "uploader": f"r/{sub}",
        "consensus": c,
        "thread": {
            "sub": sub,
            "id": post["id"],
            "url": f"https://www.reddit.com{post['permalink']}",
            "title": post.get("title"),
            "flair": post.get("link_flair_text"),
            "score": post.get("score"),
            "comments": post.get("num_comments"),
            "created": int(post.get("created_utc") or 0),
            "hosted": media["hosted"],
        },
    }
    if media.get("duration"):
        row["duration"] = media["duration"]
    return row


def listing_posts(r: Reddit, sub: str, spec: str, pages: int) -> list[dict]:
    sort, _, t = spec.partition(":")
    posts, after = [], None
    for _ in range(pages):
        params = {"limit": 100, **({"t": t} if t else {}), **({"after": after} if after else {})}
        try:
            body = r.get(f"/r/{sub}/{sort}", **params)
        except FileNotFoundError:
            break
        children = body.get("data", {}).get("children", [])
        posts += [ch["data"] for ch in children if ch.get("kind") == "t3"]
        after = body.get("data", {}).get("after")
        if not after:
            break
    return posts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--creds", default=os.environ.get("REDDIT_CREDENTIALS_FILE"))
    ap.add_argument("--sub", action="append", default=[])
    ap.add_argument("--listing", action="append", default=[], help="sort[:time], e.g. top:year, top:all, new")
    ap.add_argument("--pages", type=int, default=5, help="pages of 100 posts per listing")
    ap.add_argument("--cache", default="reddit-cache", help="raw API responses (keep out of the repo)")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--public", action="store_true", help="public JSON endpoints, no credentials")
    ap.add_argument("--fetch-only", action="store_true", help="fill --cache and stop (no scoring, no yt-dlp)")
    ap.add_argument("--min-confidence", type=float, default=0.6)
    ap.add_argument("--min-duration", type=float, default=3)
    ap.add_argument("--max-duration", type=float, default=90)
    ap.add_argument("--all-genres", action="store_true")
    ap.add_argument("--exclude", action="append", default=[], help="skip clips already in these JSONL files")
    args = ap.parse_args()
    subs = args.sub or ["isthisAI"]
    listings = args.listing or ["top:year", "top:all", "new"]

    from resolve import probe  # yt-dlp; imported late so --offline scoring needs no yt-dlp

    r = Reddit(args.creds, args.cache, args.offline, public=args.public)
    fetched = 0
    have = {clip_id(u) for u in _urls(args.exclude)}
    seen: set[str] = set()
    tally: dict[str, int] = {}
    kept = []

    def drop(why: str) -> None:
        tally[why] = tally.get(why, 0) + 1

    for sub in subs:
        posts: dict[str, dict] = {}
        for spec in listings:
            for p in listing_posts(r, sub, spec, args.pages):
                posts.setdefault(p["id"], p)
        print(f"r/{sub}: {len(posts)} posts", file=sys.stderr)
        for post in posts.values():
            media = media_of(post)
            if not media:
                drop("not a video")
                continue
            why = skip_reason(post, args.all_genres)
            if why:
                drop(why)
                continue
            key = clip_id(media["url"])
            if key in seen or key in have:
                drop("duplicate")
                continue
            try:
                tree = r.get(f"/r/{sub}/comments/{post['id']}", limit=500, depth=6, sort="top")
            except FileNotFoundError:
                drop("comments not cached")
                continue
            if args.fetch_only:
                fetched += 1
                continue
            c = consensus(post, flatten(tree[1] if isinstance(tree, list) and len(tree) > 1 else tree))
            if c["verdict"] == "unsure" or c["confidence"] < args.min_confidence:
                drop("no clear consensus")
                continue
            if not args.offline:
                dur = media.get("duration")
                if not media["hosted"]:
                    pr = probe(media["url"])
                    dur = pr["duration"] if pr else None
                    if not pr:
                        drop("link gone")
                        continue
                if not dur or not args.min_duration <= dur <= args.max_duration:
                    drop("duration")
                    continue
                media["duration"] = dur
            seen.add(key)
            kept.append(row_for(sub, post, media, c))
            print(f"keep {key}: {c['verdict']} {c['confidence']:.2f} ({c['voters']} votes) {post.get('title', '')[:60]!r}", file=sys.stderr)

    if args.fetch_only:
        print(f"cached {fetched} video threads in {args.cache}; dropped {tally}", file=sys.stderr)
        return
    kept.sort(key=lambda row: (-row["consensus"]["confidence"], -(row["thread"]["score"] or 0)))
    with open(args.out, "w") as f:
        for row in kept:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    n_ai = sum(1 for row in kept if row["label"] == "confirmed")
    print(f"kept {len(kept)} ({n_ai} AI, {len(kept) - n_ai} real) → {args.out}; dropped {tally}", file=sys.stderr)


def _urls(paths: list[str]) -> list[str]:
    out = []
    for p in paths:
        with open(p) as f:
            out += [json.loads(line).get("url", "") for line in f if line.strip()]
    ids = excluded_ids(paths)  # X posts named only by tweetId
    return out + [f"https://x.com/i/status/{i}" for i in ids]


if __name__ == "__main__":
    main()
