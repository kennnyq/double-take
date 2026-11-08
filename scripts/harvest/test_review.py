"""Offline tests for the review decisions (review.py) and build_media's
--exclude-discarded pruning.

    python3 -I scripts/harvest/test_review.py      (also run by `npm test`)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import review  # noqa: E402
from build_media import clip_id, drop_discarded  # noqa: E402

FIX = os.path.join(HERE, "..", "review", "fixtures")


class Fold(unittest.TestCase):
    def test_matches_the_review_site(self):
        # The same fixture scripts/review/decisions.test.ts folds.
        with open(os.path.join(FIX, "expected.json")) as f:
            expected = json.load(f)["states"]
        self.assertEqual(review.load(os.path.join(FIX, "decisions.jsonl")), expected)

    def test_kept(self):
        self.assertEqual(review.kept(os.path.join(FIX, "decisions.jsonl")), {"x-1"})
        self.assertEqual(review.kept(os.path.join(FIX, "nope.jsonl")), set())

    def test_only_kept_builds_nothing_unreviewed(self):
        # x-2 and x-3 have no decision in the fixture, so --only-kept must not build (or fetch) them.
        with tempfile.TemporaryDirectory() as d:
            cands = os.path.join(d, "batch.jsonl")
            with open(cands, "w") as f:
                for i in (2, 3):
                    f.write(json.dumps({"url": f"https://x.com/i/status/{i}", "label": "real"}) + "\n")
            r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_media.py"), cands, "--out", d,
                                "--only-kept", "--decisions", os.path.join(FIX, "decisions.jsonl")],
                               capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("0 of 2 new candidate(s) marked keep", r.stderr)
            with open(os.path.join(d, "feeds", "demo.json")) as f:
                self.assertEqual(json.load(f)["clips"], [])

    def test_demo_rows_stand_alone(self):
        # A kept demo row carrying pairOf comes out of a rebuild without it.
        with tempfile.TemporaryDirectory() as d:
            base = "media/yt-aaaaaaaaaaa/v1"
            os.makedirs(os.path.join(d, base))
            for name in ("720.mp4", "poster.jpg", "tile.mp4"):
                open(os.path.join(d, base, name), "w").close()
            os.makedirs(os.path.join(d, "feeds"))
            row = {"id": "yt-aaaaaaaaaaa", "video": f"{base}/720.mp4", "poster": f"{base}/poster.jpg", "sha256": "s",
                   "label": "real", "tier": "real-prior", "pairOf": "x-1", "width": 720, "height": 1280, "duration": 5}
            with open(os.path.join(d, "feeds", "demo.json"), "w") as f:
                json.dump({"version": 1, "clips": [row]}, f)
            empty = os.path.join(d, "none.jsonl")
            open(empty, "w").close()
            r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_media.py"), empty, "--out", d,
                                "--merge", "--no-dedupe"], capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(os.path.join(d, "feeds", "demo.json")) as f:
                [out] = json.load(f)["clips"]
        self.assertNotIn("pairOf", out)
        self.assertEqual((out["label"], out["tier"]), ("real", "real-prior"))

    def test_discarded_and_missing_log(self):
        self.assertEqual(review.discarded(os.path.join(FIX, "decisions.jsonl")), {"yt-abcdefghijk"})
        self.assertEqual(review.discarded(os.path.join(FIX, "nope.jsonl")), set())

    def test_undo_brings_a_clip_back(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "decisions.jsonl")
            with open(p, "w") as f:
                f.write(json.dumps({"v": 1, "id": "a", "at": "1", "by": "k", "key": "x-1", "set": {"status": "discard"}}) + "\n")
            self.assertEqual(review.discarded(p), {"x-1"})
            with open(p, "a") as f:
                f.write(json.dumps({"v": 1, "id": "b", "at": "2", "by": "k", "key": "x-1", "undo": "a"}) + "\n")
            self.assertEqual(review.discarded(p), set())


AI = {"url": "https://x.com/i/status/1", "label": "confirmed"}
AI2 = {"url": "https://x.com/i/status/2", "label": "confirmed"}
REAL_A = {"url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "label": "real", "tier": "real-prior", "pairOf": "x-1"}
REAL_B = {"url": "https://www.youtube.com/watch?v=bbbbbbbbbbb", "label": "real", "tier": "real-agency", "pairOf": "x-1"}
REAL_C = {"url": "https://www.youtube.com/watch?v=ccccccccccc", "label": "real", "tier": "real-verified", "pairOf": "x-2"}
ROWS = [AI, REAL_A, REAL_B, AI2, REAL_C]
ids = lambda rows: [r["id"] if "id" in r else clip_id(r["url"]) for r in rows]  # noqa: E731


class TellMarks(unittest.TestCase):
    def test_marks_merge_like_the_review_site_and_never_change_the_build(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "decisions.jsonl")
            rows = [
                {"v": 1, "id": "a", "at": "1", "by": "k", "key": "x-1", "set": {"status": "discard"}},
                {"v": 1, "id": "b", "at": "2", "by": "k", "key": "x-1", "set": {"tells": {"main/t1": {"pick": True}}}},
                {"v": 1, "id": "c", "at": "3", "by": "k", "key": "x-2", "set": {"tells": {"claude/t2": {"note": "late"}}}},
                {"v": 1, "id": "d", "at": "4", "by": "k", "key": "x-2", "set": {"tells": {"claude/t2": None}}},
            ]
            with open(p, "w") as f:
                f.write("".join(json.dumps(r) + "\n" for r in rows))
            states = review.load(p)
            self.assertEqual(states["x-1"]["tells"], {"main/t1": {"pick": True, "note": ""}})
            self.assertEqual(states["x-2"]["tells"], {})
            # Only status feeds the build: marks neither keep nor drop anything.
            self.assertEqual(review.discarded(p), {"x-1"})
            self.assertEqual(review.kept(p), set())


class Exclude(unittest.TestCase):
    def test_nothing_discarded_keeps_everything(self):
        self.assertEqual(drop_discarded(ROWS, set(), pairs=True), ROWS)

    def test_demo_drops_only_the_discarded_clip(self):
        self.assertEqual(ids(drop_discarded(ROWS, {"x-1", "yt-ccccccccccc"})),
                         ["yt-aaaaaaaaaaa", "yt-bbbbbbbbbbb", "x-2"])

    def test_compare_drops_a_discarded_real_clip_from_its_pair(self):
        self.assertEqual(ids(drop_discarded(ROWS, {"yt-aaaaaaaaaaa"}, pairs=True)),
                         ["x-1", "yt-bbbbbbbbbbb", "x-2", "yt-ccccccccccc"])

    def test_compare_drops_an_ai_clip_whose_real_partners_are_all_gone(self):
        self.assertEqual(ids(drop_discarded(ROWS, {"yt-ccccccccccc"}, pairs=True)),
                         ["x-1", "yt-aaaaaaaaaaa", "yt-bbbbbbbbbbb"])

    def test_compare_drops_the_real_partners_of_a_discarded_ai_clip(self):
        self.assertEqual(ids(drop_discarded(ROWS, {"x-1"}, pairs=True)), ["x-2", "yt-ccccccccccc"])

    def test_feed_rows_are_keyed_by_id(self):
        feed = [{"id": "x-1", "video": "v"}, {"id": "yt-aaaaaaaaaaa", "pairOf": "x-1"}]
        self.assertEqual(ids(drop_discarded(feed, {"yt-aaaaaaaaaaa"}, pairs=True)), [])


class BuildCli(unittest.TestCase):
    """build_media.py --merge on a ready-built feed (no downloads), with and without the flag."""

    def run_build(self, out: str, *flags: str) -> list[str]:
        cands = os.path.join(out, "cands.jsonl")
        with open(cands, "w") as f:
            f.write(json.dumps({"url": "https://x.com/i/status/9100000000000000001"}) + "\n")
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_media.py"), cands, "--out", out,
                            "--merge", "--feed", "compare", *flags], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, "feeds", "compare.json")) as f:
            return [c["id"] for c in json.load(f)["clips"]]

    def test_only_the_flag_excludes(self):
        ai, real = "x-9100000000000000001", "yt-test0000001"
        with tempfile.TemporaryDirectory() as out:
            rows = []
            for cid, extra in ((ai, {}), (real, {"pairOf": ai})):
                media = f"media/{cid}/v1"
                os.makedirs(os.path.join(out, media))
                for name in ("720.mp4", "tile.mp4", "poster.jpg"):
                    open(os.path.join(out, media, name), "w").close()
                rows.append({"id": cid, "video": f"{media}/720.mp4", "poster": f"{media}/poster.jpg",
                             "sha256": cid, **extra})
            os.makedirs(os.path.join(out, "feeds"))

            def reset():
                with open(os.path.join(out, "feeds", "compare.json"), "w") as f:
                    json.dump({"version": 1, "clips": rows}, f)

            decisions = os.path.join(out, "decisions.jsonl")
            with open(decisions, "w") as f:
                f.write(json.dumps({"v": 1, "id": "a", "at": "1", "by": "k", "key": real, "set": {"status": "discard"}}) + "\n")
            reset()
            self.assertEqual(self.run_build(out, "--decisions", decisions), [ai, real])
            reset()
            # The real clip goes, and its AI clip, now without a partner, goes with it.
            self.assertEqual(self.run_build(out, "--exclude-discarded", "--decisions", decisions), [])


if __name__ == "__main__":
    unittest.main()
