"""Offline tests for review_publish.py: session, counts, feed diff, limits, backups,
preflight and the no-working-tree commit.

    python3 -I scripts/harvest/test_review_publish.py      (also run by `npm test`)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import review_publish as rp  # noqa: E402


def ev(i, at, key="x-1", **kw):
    e = {"v": 1, "id": f"e{i}", "at": at, "by": "kenny", "key": key}
    e.update(kw if kw else {"set": {"status": "keep"}})
    return e


def log(*events):
    return "".join(json.dumps(e) + "\n" for e in events)


class Logs(unittest.TestCase):
    def test_merge_keeps_main_and_appends_new_events_in_time_order(self):
        a, b, c = ev(1, "2026-11-08T01:00:00Z"), ev(2, "2026-11-08T03:00:00Z"), ev(3, "2026-11-08T02:00:00Z")
        text, new = rp.merge_logs(log(a), [log(a, b), log(c), "not json\n"])
        self.assertEqual([e["id"] for e in new], ["e3", "e2"])
        self.assertEqual([json.loads(l)["id"] for l in text.splitlines()], ["e1", "e3", "e2"])
        # Nothing new: the text is main's, unchanged.
        self.assertEqual(rp.merge_logs(log(a), [log(a)]), (log(a), []))

    def test_session_is_everything_after_the_marker(self):
        evs = [ev(1, "2026-11-08T01:00:00Z"), ev(2, "2026-11-08T02:00:00Z"), ev(3, "2026-11-08T02:00:00Z")]
        self.assertEqual(len(rp.session_events(evs, None)), 3)
        marker = {"at": "2026-11-08T02:00:00Z", "cursor": "e2"}
        self.assertEqual([e["id"] for e in rp.session_events(evs, marker)], ["e3"])

    def test_counts(self):
        evs = [
            ev(1, "t1", set={"status": "keep", "note": "nice"}),
            ev(2, "t2", set={"status": "discard"}),
            ev(3, "t3", set={"status": "needs-work"}),
            ev(4, "t4", set={"status": None}),
            ev(5, "t5", undo="e2"),
            ev(6, "t6", set={"tells": {"main/1": {"pick": True}, "main/2": {"pick": False, "note": "box is off"},
                                       "main/3": None}}),
            ev(7, "t7", set={"tags": ["x"], "note": "  "}),
        ]
        c = rp.session_counts(evs)
        self.assertEqual((c["decisions"], c["keep"], c["drop"], c["needsWork"], c["cleared"], c["undo"]),
                         (7, 1, 1, 1, 1, 1))
        self.assertEqual(c["stars"], [{"key": "x-1", "tell": "main/1", "by": "kenny"}])
        self.assertEqual([n["note"] for n in c["notes"]], ["nice", "box is off"])


class Feed(unittest.TestCase):
    def test_diff_and_totals(self):
        old = [{"id": "a", "label": "confirmed"}, {"id": "b", "label": "real"}]
        new = [{"id": "b", "label": "real"}, {"id": "c", "label": "real"}, {"id": "d", "label": "not-ai-cgi"}]
        self.assertEqual(rp.feed_diff(old, new), {"added": ["c", "d"], "removed": ["a"]})
        self.assertEqual(rp.feed_totals(new), {"clips": 3, "ai": 0, "real": 2, "other": 1})

    def test_shipped_files_limits_and_missing_media(self):
        with tempfile.TemporaryDirectory() as d:
            def put(rel, size):
                os.makedirs(os.path.dirname(os.path.join(d, rel)) or d, exist_ok=True)
                with open(os.path.join(d, rel), "wb") as f:
                    f.write(b"x" * size)
            put("media/a/v1/720.mp4", 100)
            put("media/a/v1/poster.jpg", 10)
            put("feeds/demo.json", 5)
            put("archive/abc/original.mp4", 10**6)   # never shipped
            put("annotate/a/frames.jpg", 50)          # never shipped
            put("media/a/v1/720.mp4.123.tmp", 7)      # a write in progress
            files = dict(rp.shipped_files(d))
            self.assertEqual(sorted(files), ["feeds/demo.json", "media/a/v1/720.mp4", "media/a/v1/poster.jpg"])
            lim = rp.limits(list(files.items()))
            self.assertEqual((lim["files"], lim["bytes"], lim["largest"]["path"], lim["ok"]), (5, 115, "media/a/v1/720.mp4", True))
            self.assertFalse(rp.limits([("big.mp4", rp.MAX_FILE_BYTES + 1)])["ok"])
            self.assertFalse(rp.limits([("f", 1)] * rp.MAX_FILES)["ok"])  # + manifest + .assetsignore
            clips = [{"id": "a", "video": "media/a/v1/720.mp4", "poster": "media/a/v1/poster.jpg"},
                     {"id": "b", "video": "media/b/v1/720.mp4", "poster": "media/b/v1/poster.jpg"}]
            self.assertEqual(rp.missing_media(d, clips), ["b:video", "b:poster"])

    def test_summary_line_leads_with_the_session(self):
        s = {"session": {"since": "2026-11-08T07:51:47.795Z",
                         "counts": {"decisions": 3, "keep": 1, "drop": 1, "stars": [{}], "notes": [{}, {}]}},
             "diff": {"added": ["c"], "removed": ["a", "b"]},
             "after": {"clips": 233, "ai": 150, "real": 83},
             "limits": {"bytes": 2 * 2**30, "files": 900, "maxFiles": 20000, "largest": {"bytes": 25 * 2**20},
                        "maxFileBytes": rp.MAX_FILE_BYTES},
             "missing": []}
        self.assertEqual(rp.summary_line(s),
                         "Review session since 2026-11-08 07:51 UTC: 3 decisions (1 keep, 1 drop, 1 stars, 2 notes) "
                         "-> +1 / -2 clips. Feed: 233 clips (150 AI, 83 real), 2.00 GiB, 900/20000 files, "
                         "largest 25.0/25 MiB, missing media 0.")


class Deploy(unittest.TestCase):
    def test_backup_rotation_keeps_two(self):
        names = ["build", "build-next", "build-prev", "build-prev-20261101-000000", "build-prev-20261102-000000"]
        plan = rp.backup_plan(names, "20261108-090000")
        self.assertEqual(plan["rename"], ("build-prev", "build-prev-20261108-090000"))
        # build/ becomes build-prev; with the newest timestamped one that's two backups.
        self.assertEqual(plan["delete"], ["build-prev-20261102-000000", "build-prev-20261101-000000"])
        self.assertEqual(rp.backup_plan(["build", "build-next"], "s"), {"rename": None, "delete": []})

    def test_preflight(self):
        good = {"missing": [], "limits": {"ok": True}, "hashes": {"live": "L", "next": "N"}}
        done = {"state": "done"}
        self.assertEqual(rp.preflight(good, done, "L", "N"), [])
        self.assertIn("no summary", rp.preflight(None, None, "L", "N")[0])
        errs = rp.preflight({**good, "missing": ["a:video"], "limits": {"ok": False}}, {"state": "failed"}, "X", "Y")
        self.assertEqual(len(errs), 5)
        self.assertTrue(any("build/ changed" in e for e in errs))
        self.assertTrue(any("build-next changed" in e for e in errs))


class Commit(unittest.TestCase):
    def test_commits_on_the_branch_without_touching_the_working_tree(self):
        with tempfile.TemporaryDirectory() as d:
            g = lambda *a: subprocess.run(["git", "-C", d, *a], capture_output=True, text=True, check=True).stdout.strip()  # noqa: E731
            g("init", "-q", "-b", "main")
            g("config", "user.email", "t@example.com")
            g("config", "user.name", "t")
            os.makedirs(os.path.join(d, "scripts/harvest/review"))
            path = os.path.join(d, rp.DECISIONS_REL)
            with open(path, "w") as f:
                f.write("old\n")
            g("add", ".")
            g("commit", "-qm", "init")
            null = open(os.devnull, "w")
            self.addCleanup(null.close)
            ctx = rp.Ctx(d, log=null)
            c = rp.commit_file(ctx, "main", rp.DECISIONS_REL, "old\nnew\n", "chore: decisions")
            self.assertEqual(g("show", f"{rp.BRANCH}:{rp.DECISIONS_REL}"), "old\nnew")
            self.assertEqual(g("rev-parse", rp.BRANCH), c)
            with open(path) as f:
                self.assertEqual(f.read(), "old\n")           # working tree untouched
            self.assertEqual(g("status", "--porcelain", "--untracked-files=no"), "")  # nor the index
            # Same content again: no new commit.
            self.assertEqual(rp.commit_file(ctx, "main", rp.DECISIONS_REL, "old\n", "noop"), g("rev-parse", "main"))


if __name__ == "__main__":
    unittest.main()
