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


if __name__ == "__main__":
    unittest.main()
