"""Offline tests for the real-clip harvest: note classifier, genre filter, links,
subject queries, probe filter, tier labels and the committed real batches.

    python3 -I scripts/harvest/test_harvest.py      (also run by `npm test`)
"""
import glob
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_media import COMPARE_FIELDS, clip_id, reuse  # noqa: E402
from consensus import consensus, flair_verdict, flatten, stance, summary  # noqa: E402
from pick_reddit import from_capture, media_of, post_from_capture, row_for, skip_reason  # noqa: E402
from pick_real import LABEL_FOR_TIER, classify, harmless, real_links  # noqa: E402
from resolve import keep  # noqa: E402
from search_real import overlap, subject_query, tier_for  # noqa: E402

# Labels the app turns into a verdict (feat/app-settings, verdictFromLabel in
# src/data/remote.ts). Keep in step with it.
APP_AI = {"confirmed", "ai"}
APP_REAL = {"real", "not_ai", "authentic"}


class Classify(unittest.TestCase):
    def test_not_ai_notes_are_negatives(self):
        for text in [
            "This isn't an AI-generated video. The BBC has had this video posted on their YouTube channel since 2017.",
            "This video is not AI generated, however it is a hoax - there is a fishing line attached to the creature.",
            "The footage shown is authentic dashcam video, not AI-generated.",
        ]:
            self.assertEqual(classify(text), "negative", text)

    def test_cgi_and_games_are_their_own_class(self):
        self.assertEqual(classify("This is not AI, this is CGI. This short video was made for France 3 in 2015."), "cgi")
        self.assertEqual(classify("The video shows gameplay from Wolfpack, not AI-generated content."), "cgi")

    def test_ai_notes_that_mention_real_footage_are_not_negatives(self):
        # The pitfall: "not real footage" is how AI notes talk.
        text = "This video is AI-generated, not real footage of a cat and hawk. https://www.instagram.com/reel/DSAUMYcj9sg"
        self.assertIsNone(classify(text))
        text = "The video is AI-generated, with jerky physics inconsistent with real footage. https://x.com/a/status/1"
        self.assertIsNone(classify(text))
        text = "AI-generated animation, not a real clip from City Hunter. https://x.com/a/status/2"
        self.assertIsNone(classify(text))

    def test_ai_notes_linking_the_original_are_pairs(self):
        for text in [
            "This is AI generated Here is the original clip https://www.youtube.com/watch?v=NtNThEqB31Q",
            "This video is AI-generated. Here is real video of this hurricane: https://x.com/flynonymouswx/status/1982915178221191411?s=46",
            "It is AI-generated. A real footage of the Tesla Roadster event is shown here: https://www.youtube.com/live/qt5p-_tE8d0",
        ]:
            self.assertEqual(classify(text), "pair", text)

    def test_pairs_need_a_video_link(self):
        self.assertIsNone(classify("This is AI-generated. The original video was on the news. https://www.bbc.co.uk/news/x"))

    def test_notes_not_about_video_are_skipped(self):
        self.assertIsNone(classify("This image is not AI generated. https://example.com"))


class Genre(unittest.TestCase):
    def test_off_genre_notes_are_dropped(self):
        for text in [
            "The video of the princess is not AI-generated, it was filmed by the BBC.",
            "Grok is wrong, Netanyahu is not dead, the video was not AI-generated.",
            "The video depicts real students from Walden Grove High School performing a lip dub.",
            "This clip is from a Bollywood film called Singham and is not AI generated.",
        ]:
            self.assertFalse(harmless(text), text)

    def test_animal_and_weather_notes_pass(self):
        self.assertTrue(harmless("This video is not AI generated, however it is a hoax - fishing line on the creature."))
        self.assertTrue(harmless("This video is AI-generated. Here is real video of this hurricane."))


class Links(unittest.TestCase):
    def test_links_are_cleaned_and_filtered(self):
        text = ("Original: https://youtu.be/yX-LJS38S70?si=abc and https://x.com/grok/status/123 "
                "and https://x.com/someone/status/42 and https://x.com/i/status/99 https://www.bbc.com/news")
        self.assertEqual(real_links(text, own_id="99"), ["https://youtu.be/yX-LJS38S70", "https://x.com/someone/status/42"])


class Search(unittest.TestCase):
    def test_subject_query_puts_subjects_first(self):
        self.assertEqual(subject_query("Rob - Alpaca screams at motorist and spits on his windshield", author="Rob"),
                         "alpaca screams motorist spits windshield")
        self.assertEqual(subject_query("If a lion got this close to you, what would you do?"), "lion close")
        self.assertEqual(subject_query("https://t.co/abc"), "")

    def test_subject_falls_back_to_the_note(self):
        q = subject_query("https://t.co/x", "AI-generated: the bear's paw merges with the car door handle.")
        self.assertTrue(q.startswith("bear"), q)

    def test_overlap(self):
        self.assertEqual(overlap("alpaca spits on car", "Alpaca or Llama Tries to Get in Our Car"), 2 / 3)
        self.assertEqual(overlap("", "anything"), 0.0)

    def test_tiers(self):
        self.assertEqual(tier_for({"uploadDate": "20161108", "channel": "BBC"}), "real-prior")
        self.assertEqual(tier_for({"uploadDate": "20240301", "channel": "ViralHog"}), "real-agency")
        self.assertIsNone(tier_for({"uploadDate": "20240301", "channel": "Some Shorts"}))
        self.assertIsNone(tier_for({"uploadDate": None, "channel": "Some Shorts"}))


class Probe(unittest.TestCase):
    def test_keep(self):
        p = {"duration": 20.0, "mediaId": "1"}
        self.assertIsNone(keep(p, set(), 3, 90))
        self.assertIn("repost", keep(p, {"1"}, 3, 90))
        self.assertIn("outside", keep({**p, "duration": 120.0}, set(), 3, 90))
        self.assertIn("gone", keep(None, set(), 3, 90))


class Labels(unittest.TestCase):
    def test_every_real_tier_maps_to_an_app_real_label(self):
        for tier, label in LABEL_FOR_TIER.items():
            if tier.startswith("real-"):
                self.assertIn(label, APP_REAL, tier)
        # CGI must never read as real (or AI) in the app.
        self.assertNotIn(LABEL_FOR_TIER["not-ai-cgi"], APP_REAL | APP_AI)

    def test_committed_real_batches(self):
        files = sorted(glob.glob(os.path.join(HERE, "real-*.jsonl")))
        self.assertTrue(files)
        for path in files:
            with open(path) as f:
                rows = [json.loads(line) for line in f if line.strip()]
            ids = {clip_id(r["url"]) for r in rows}
            for r in rows:
                where = f"{os.path.basename(path)}: {r['url']}"
                self.assertTrue(r.get("evidence"), where)
                if r["label"] in APP_AI:
                    self.assertNotIn("tier", r, where)
                    continue
                self.assertEqual(r["label"], LABEL_FOR_TIER[r["tier"]], where)
                self.assertIn(r["label"], APP_REAL, f"{where}: CGI clips stay out of the feed")
                if r.get("pairOf"):
                    # Every pair is shippable on its own: its AI clip is in the same batch.
                    self.assertIn(r["pairOf"], ids, where)


class Reuse(unittest.TestCase):
    def test_reuse_keeps_media_and_takes_the_candidates_comparison_fields(self):
        row = {"id": "x-1", "video": "media/x-1/v1/720.mp4", "label": "confirmed", "pairOf": "stale"}
        out = reuse(row, {"url": "https://x.com/i/status/1", "label": "confirmed", "evidence": "note"})
        self.assertEqual(out["video"], row["video"])
        self.assertEqual(out["evidence"], "note")
        self.assertFalse(any(k in out for k in COMPARE_FIELDS))
        out = reuse(row, {"url": "u", "label": "real", "tier": "real-prior", "pairOf": "x-2"})
        self.assertEqual((out["label"], out["tier"], out["pairOf"]), ("real", "real-prior", "x-2"))


def thread(*comments, flair=None, op="asker"):
    post = {"author": op, "link_flair_text": flair}
    return post, [{"author": f"u{i}", "body": b, "score": sc, "permalink": f"/r/x/comments/1/_/c{i}/", **extra}
                  for i, (b, sc, *rest) in enumerate(comments) for extra in [rest[0] if rest else {}]]


class Consensus(unittest.TestCase):
    def test_stance(self):
        for text, want in [
            ("AI", "ai"), ("Real.", "real"), ("100% AI slop", "ai"), ("Not real", "ai"),
            ("It's not AI, I saw this video in 2019", "real"), ("This is AI, look at the hands", "ai"),
            ("The original video is on YouTube", "real"), ("Sora watermark at 0:03", "ai"),
            ("is this real?", None), ("lol", None), ("Not AI. Not real either, it's CGI", None),
        ]:
            self.assertEqual(stance(text), want, text)

    def test_flair(self):
        self.assertEqual(flair_verdict("AI Generated"), "ai")
        self.assertEqual(flair_verdict("Confirmed AI"), "ai")
        self.assertEqual(flair_verdict("Not AI"), "real")
        self.assertEqual(flair_verdict("Real"), "real")
        self.assertEqual(flair_verdict("Unsure"), None)
        self.assertEqual(flair_verdict("Photoshopped"), None)
        self.assertEqual(flair_verdict(None), None)

    def test_score_weighting_beats_head_count(self):
        # One +400 "real" outweighs three +1 "AI" comments (sqrt weights: ~20 vs ~4.2).
        post, cs = thread(("This is real, posted back in 2018", 400), ("AI", 1), ("fake", 1), ("ai slop", 1))
        c = consensus(post, cs)
        self.assertEqual(c["verdict"], "real")
        self.assertGreater(c["confidence"], 0.6)
        self.assertEqual(c["evidence"][0]["score"], 400)

    def test_split_thread_is_unsure(self):
        post, cs = thread(("AI", 10), ("Real", 10), ("ai for sure", 9), ("definitely real", 9))
        self.assertEqual(consensus(post, cs)["verdict"], "unsure")

    def test_too_few_votes_is_unsure_without_flair(self):
        post, cs = thread(("AI", 50), ("lol", 3))
        self.assertEqual(consensus(post, cs)["verdict"], "unsure")
        post["link_flair_text"] = "AI"
        self.assertEqual(consensus(post, cs)["verdict"], "ai")

    def test_flair_settles_a_split_thread_but_not_a_landslide(self):
        post, cs = thread(("Real", 4), ("AI", 1), ("ai", 1), flair="AI Generated")
        c = consensus(post, cs)
        self.assertEqual((c["verdict"], c["flairVerdict"]), ("ai", "ai"))
        # Against a unanimous thread the flair only gets it to unsure.
        post, cs = thread(*[("AI", 100)] * 4, flair="Not AI")
        self.assertEqual(consensus(post, cs)["verdict"], "unsure")

    def test_mods_count_more_and_bots_and_op_not_at_all(self):
        post, cs = thread(("Real", 5), ("real", 5), ("This is AI, removing.", 1, {"distinguished": "moderator"}),
                          ("Please vote", 100, {"author": "AutoModerator"}))
        cs.append({"author": "asker", "body": "it's real!!", "score": 500})
        c = consensus(post, cs)
        self.assertEqual(c["voters"], 3)
        self.assertEqual(c["verdict"], "unsure")  # mod ~7.1 vs real ~4.9
        self.assertTrue(any(e.get("mod") for e in consensus(post, cs, evidence_n=5)["evidence"]))

    def test_tells_and_summary(self):
        post, cs = thread(("It's AI, the hands morph at 0:04", 30), ("AI - text on the sign is gibberish", 20),
                          ("ai, extra fingers on the hands", 5))
        c = consensus(post, cs)
        self.assertEqual(c["verdict"], "ai")
        self.assertEqual(c["tells"][0], {"tell": "hands", "count": 2})
        text = summary("isthisAI", c)
        self.assertTrue(text.startswith("r/isthisAI consensus: AI (1.00, 3 votes)"), text)
        self.assertIn("(+30)", text)
        self.assertIn("Tells cited: hands", text)

    def test_flatten_walks_replies(self):
        tree = {"kind": "Listing", "data": {"children": [
            {"kind": "t1", "data": {"body": "a", "replies": {"kind": "Listing", "data": {"children": [
                {"kind": "t1", "data": {"body": "b", "replies": ""}}]}}}},
            {"kind": "more", "data": {}}]}}
        self.assertEqual([c["body"] for c in flatten(tree)], ["a", "b"])


class RedditRows(unittest.TestCase):
    POST = {"id": "1abc", "permalink": "/r/isthisAI/comments/1abc/goat/", "title": "Goat on a cliff?",
            "score": 120, "num_comments": 40, "created_utc": 1767225600, "link_flair_text": "Not AI"}

    def test_media_of(self):
        hosted = {**self.POST, "url": "https://v.redd.it/xyz9", "secure_media": {"reddit_video": {
            "hls_url": "https://v.redd.it/xyz9/HLSPlaylist.m3u8?a=1&f=sd", "duration": 21}}}
        m = media_of(hosted)
        self.assertEqual(m["url"], "https://www.reddit.com/r/isthisAI/comments/1abc/goat/")
        self.assertEqual(m["download"], "https://v.redd.it/xyz9/HLSPlaylist.m3u8")
        self.assertEqual(clip_id(m["url"]), "rd-1abc")
        linked = {**self.POST, "url": "https://x.com/someone/status/123?s=20"}
        self.assertEqual(media_of(linked), {"url": "https://x.com/someone/status/123", "hosted": False})
        self.assertIsNone(media_of({**self.POST, "url": "https://i.redd.it/photo.jpeg"}))
        cross = {**self.POST, "url": "/r/x/comments/9", "crosspost_parent_list": [hosted]}
        self.assertTrue(media_of(cross)["hosted"])

    def test_curation(self):
        self.assertEqual(skip_reason({**self.POST, "over_18": True}, False), "nsfw")
        self.assertEqual(skip_reason({**self.POST, "title": "Police officer throws woman"}, False), "off-genre")
        self.assertIsNone(skip_reason({**self.POST, "title": "Police officer throws woman"}, True))
        self.assertIsNone(skip_reason(self.POST, False))

    def test_labels(self):
        media = {"url": "https://www.reddit.com/r/isthisAI/comments/1abc/goat/", "download": "d", "hosted": True}
        real = row_for("isthisAI", self.POST, media, {"verdict": "real", "confidence": 0.9, "voters": 5, "flair": "Not AI",
                                                      "evidence": [], "tells": []})
        self.assertEqual((real["label"], real["tier"], real["how"]), ("real", "real-consensus", "reddit-consensus"))
        self.assertIn(real["label"], APP_REAL)
        ai = row_for("isthisAI", self.POST, media, {"verdict": "ai", "confidence": 0.9, "voters": 5, "flair": None,
                                                    "evidence": [], "tells": []})
        self.assertEqual(ai["label"], "confirmed")
        self.assertNotIn("tier", ai)

    def test_browser_capture_converts_to_api_shapes(self):
        listed = {"listing": "top:year", "id": "t3_1abc", "permalink": "/r/isthisAI/comments/1abc/goat/",
                  "content-href": "https://v.redd.it/xyz9", "post-type": "video", "score": "1204",
                  "comment-count": "88", "created-timestamp": "2026-01-01T17:02:36.603000+0000",
                  "post-title": "Goat on a cliff?", "author": "someone", "flair": "Solved [Not AI]"}
        post = post_from_capture(listed)
        self.assertEqual((post["id"], post["score"], post["num_comments"], post["over_18"]), ("1abc", 1204, 88, False))
        self.assertEqual(post["link_flair_text"], "Solved [Not AI]")
        self.assertEqual(flair_verdict(post["link_flair_text"]), "real")
        self.assertEqual(flair_verdict("Solved [AI]"), "ai")
        self.assertEqual(int(post["created_utc"]), 1767286956)
        m = media_of(post)
        self.assertEqual((m["download"], m["duration"], m["hosted"]), ("https://v.redd.it/xyz9/HLSPlaylist.m3u8", None, True))
        self.assertIsNone(media_of(post_from_capture({**listed, "post-type": "image", "content-href": "https://i.redd.it/a.jpeg"})))
        self.assertTrue(post_from_capture({**listed, "nsfw": ""})["over_18"])

        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write(json.dumps(listed) + "\n")
            f.write(json.dumps({**listed, "id": "t3_other", "permalink": "/r/pics/comments/other/x/"}) + "\n")
            f.write(json.dumps({"thread": "t3_1abc", "comments": [
                {"body": "Real. I've seen this video in 2019", "score": "40", "depth": 0, "author": "a", "permalink": "/c/1"},
                {"body": "AI", "score": 2, "depth": 1, "author": "b", "mod": True}]}) + "\n")
        posts, comments = from_capture([f.name], "isthisAI")
        os.unlink(f.name)
        self.assertEqual(list(posts), ["1abc"])
        self.assertEqual([c["score"] for c in comments["1abc"]], [40, 2])
        self.assertEqual(comments["1abc"][1]["distinguished"], "moderator")
        c = consensus(posts["1abc"], comments["1abc"])
        self.assertEqual(c["verdict"], "real")

    def test_committed_reddit_batches(self):
        for path in sorted(glob.glob(os.path.join(HERE, "reddit-*.jsonl"))):
            with open(path) as f:
                rows = [json.loads(line) for line in f if line.strip()]
            self.assertTrue(rows, path)
            for r in rows:
                c = r["consensus"]
                where = f"{os.path.basename(path)}: {r['url']}"
                self.assertIn(c["verdict"], ("ai", "real"), where)
                self.assertGreaterEqual(c["confidence"], 0.6, where)
                self.assertEqual(r["label"], "confirmed" if c["verdict"] == "ai" else "real", where)
                self.assertEqual(r.get("tier"), None if c["verdict"] == "ai" else "real-consensus", where)
                self.assertTrue(r["evidence"].startswith(f"r/{r['thread']['sub']} consensus"), where)


def _scene(n: int, seed: int) -> list[int]:
    import random
    r = random.Random(seed)
    return [r.getrandbits(64) for _ in range(n)]


class Dedupe(unittest.TestCase):
    SCENE = _scene(40, 7)

    @staticmethod
    def noisy(hashes, flips=3, seed=1):
        import random
        r = random.Random(seed)
        out = []
        for h in hashes:
            for _ in range(flips):
                h ^= 1 << r.randrange(64)
            out.append(h)
        return out

    def clip(self, cid, **kw):
        return {"id": cid, "video": f"media/{cid}/v1/720.mp4", "width": 720, "height": 1280, "duration": 10,
                "tells": None, "sha256": cid, "source": {"url": f"https://x.com/i/status/{cid}"}, **kw}

    def test_same_footage_lines_up_even_when_trimmed_and_reencoded(self):
        import dedupe
        a = self.SCENE[:20]
        b = self.noisy(self.SCENE[3:18], seed=2)  # trimmed both ends, re-encoded
        short, long_ = dedupe.share(a, b)
        self.assertGreaterEqual(short, 0.9)
        self.assertGreaterEqual(long_, 0.6)

    def test_lookalike_frames_out_of_order_dont_add_up(self):
        import dedupe
        a = self.SCENE[:20]
        b = list(reversed(self.SCENE[:20]))[::3]  # same frames, shuffled order
        self.assertLess(dedupe.share(a, b)[0], dedupe.MIN_SHARE)
        rnd = __import__("random").Random(3)
        self.assertLess(dedupe.share(a, [rnd.getrandbits(64) for _ in range(20)])[0], 0.2)

    def test_groups_keep_the_better_annotated_copy_and_repoint_pairs(self):
        import dedupe
        clips = [self.clip("x-1"), self.clip("x-2", tells="t.json", tellsAlt={"claude": "c.json"}),
                 self.clip("x-3"), self.clip("yt-4", pairOf="x-1", label="real")]
        frames = {"x-1": self.SCENE[:12], "x-2": self.noisy(self.SCENE[:12]), "x-3": self.SCENE[20:32],
                  "yt-4": self.SCENE[30:40]}
        groups = dedupe.find_duplicates(clips, frames)
        self.assertEqual(groups, [{"keep": "x-2", "drop": [{"id": "x-1", "why": "same footage", "share": 1.0}]}])
        dedupe.load_frames = lambda c, root, cache=None: frames  # no ffmpeg needed here
        try:
            kept, _ = dedupe.dedupe(clips, "build")
        finally:
            import importlib
            importlib.reload(dedupe)
        self.assertEqual([c["id"] for c in kept], ["x-2", "x-3", "yt-4"])
        self.assertEqual(kept[2]["pairOf"], "x-2")

    def test_exact_matches_need_no_frames(self):
        import dedupe
        clips = [self.clip("x-1"), self.clip("x-2", sha256="x-1"), self.clip("x-3", source={"url": "https://x.com/i/status/x-1"})]
        groups = dedupe.find_duplicates(clips, {})
        self.assertEqual(groups[0]["keep"], "x-1")
        self.assertEqual(sorted((d["id"], d["why"]) for d in groups[0]["drop"]),
                         [("x-2", "same file"), ("x-3", "same source URL")])

    def test_a_clip_inside_a_compilation_is_an_overlap_not_a_drop(self):
        import dedupe
        rnd = __import__("random").Random(9)
        comp = [rnd.getrandbits(64) for _ in range(30)] + self.SCENE[:8] + [rnd.getrandbits(64) for _ in range(30)]
        clips = [self.clip("x-1"), self.clip("x-2")]
        overlaps = []
        self.assertEqual(dedupe.find_duplicates(clips, {"x-1": comp, "x-2": self.SCENE[:8]}, overlaps), [])
        self.assertEqual((overlaps[0]["a"], overlaps[0]["b"], overlaps[0]["short"]), ("x-1", "x-2", 1.0))

    def test_dhash_survives_a_reencode_at_another_size(self):
        import shutil, subprocess, tempfile
        import dedupe
        if not shutil.which("ffmpeg"):
            self.skipTest("no ffmpeg")
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, "a.mp4"), os.path.join(d, "b.mp4")
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=6",
                            "-pix_fmt", "yuv420p", a], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-i", a, "-vf", "scale=360:640", "-crf", "35", b], check=True)
            ha, hb = dedupe.dhash_frames(a), dedupe.dhash_frames(b)
            self.assertGreaterEqual(len(ha), 5)
            self.assertGreaterEqual(dedupe.share(ha, hb)[0], 0.9)


if __name__ == "__main__":
    unittest.main()
