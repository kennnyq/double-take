import { test } from 'node:test';
import assert from 'node:assert/strict';
import { follow, layoutSections, localProgress, presence, stepsAt, wheels, SECTION_SCREENS } from './timeline.ts';
import { checkLook, dotLook, walkFrame, STEPS_FROM, STEPS_TO } from './walk.ts';
import { DEMO_CATEGORIES, GAME_CALLS, answer, demoSkillState, demoSkills, isRight } from './mock.ts';
import { toScore } from '../../skills/skill.ts';

test('layoutSections: end to end, scaled, skipping hidden ones', () => {
  const l = layoutSections(['scroll', 'game'], 0.5);
  assert.equal(l.sections[0].start, 0);
  assert.equal(l.sections[1].start, SECTION_SCREENS.scroll * 0.5);
  assert.equal(l.total, (SECTION_SCREENS.scroll + SECTION_SCREENS.game) * 0.5);
});

test('presence: neighbours cross over at their shared edge and sum to one', () => {
  const { sections } = layoutSections(['scroll', 'upload', 'game']);
  const [a, b] = sections;
  for (const pos of [a.end - 0.2, a.end - 0.1, a.end, a.end + 0.1, a.end + 0.2]) {
    const sum = presence(a, pos, 0.5, true, false) + presence(b, pos, 0.5, false, false);
    assert.ok(Math.abs(sum - 1) < 1e-9, `at ${pos}: ${sum}`);
  }
  assert.equal(presence(a, -3, 0.5, true, false), 1, 'the first is there before the track');
  assert.equal(presence(b, b.start + 1, 0.5, false, false), 1);
});

test('localProgress: 0 at the start, 1 at the end, unclamped past them', () => {
  const [s] = layoutSections(['upload']).sections;
  assert.equal(localProgress(s, s.start), 0);
  assert.equal(localProgress(s, s.end), 1);
  assert.ok(localProgress(s, s.end + 1) > 1);
});

test('follow: moves part of the way, never past, and retargets from where it is', () => {
  const a = follow(0, 1, 16, 90);
  assert.ok(a > 0 && a < 1);
  const b = follow(a, 0, 16, 90);
  assert.ok(b < a && b > 0, 'a new target turns it around from where it is');
  assert.equal(follow(0.3, 1, 16, 0), 1, 'no smoothing: right there');
});

test('stepsAt: clamps before and after, continuous through steps', () => {
  assert.deepEqual(stepsAt(0, 3, 0.2, 0.8), { index: 0, s: 0 });
  assert.deepEqual(stepsAt(1, 3, 0.2, 0.8), { index: 2, s: 1 });
  const mid = stepsAt(0.5, 3, 0.2, 0.8);
  assert.equal(mid.index, 1);
  assert.ok(Math.abs(mid.s - 0.5) < 1e-9);
});

/** The largest change between neighbouring samples of `f` over [a, b]. */
function maxJump(f: (p: number) => number, a = -0.1, b = 1.1, n = 40000) {
  let worst = 0;
  let last = f(a);
  for (let i = 1; i <= n; i++) {
    const v = f(a + ((b - a) * i) / n);
    worst = Math.max(worst, Math.abs(v - last));
    last = v;
  }
  return worst;
}

test('walkFrame: every motion is continuous in the scroll (no jumps)', () => {
  for (const n of [2, 3, 4]) {
    assert.ok(maxJump((p) => walkFrame(p, n).swipe) < 0.01);
    assert.ok(maxJump((p) => walkFrame(p, n).open) < 0.01);
    assert.ok(maxJump((p) => walkFrame(p, n).at) < 0.01, 'the step position');
    assert.ok(maxJump((p) => walkFrame(p, n).lift) < 0.02, 'the card out and back');
    assert.ok(maxJump((p) => walkFrame(p, n).footer) < 0.02, 'the card\'s bottom row');
    assert.ok(maxJump((p) => walkFrame(p, n).hand) < 0.01, 'the hand');
    for (let j = 0; j < n; j++) assert.ok(maxJump((p) => walkFrame(p, n).text[j]) < 0.02, `step ${j}'s text`);
  }
});

test('walkFrame: the walkthrough is closed before and after, on each step in between', () => {
  assert.equal(walkFrame(0, 3).open, 0);
  assert.equal(walkFrame(1, 3).open, 0);
  const span = (STEPS_TO - STEPS_FROM) / 3;
  for (let k = 0; k < 3; k++) {
    const f = walkFrame(STEPS_FROM + span * (k + 0.5), 3);
    assert.equal(f.index, k);
    assert.equal(f.video, k);
    assert.equal(f.open, 1);
    assert.equal(f.text[k], 1, 'its text fully in by mid-step');
  }
  assert.equal(walkFrame(0.05, 3).video, -1, 'the feed plays before it opens');
  assert.equal(walkFrame(STEPS_FROM + span * 1.5, 3).footer, 1, 'the bottom row stays as the steps change');
});

test('dots and check: reached in order, the check only on the last step', () => {
  assert.equal(dotLook(0, 0).reached, 1);
  assert.equal(dotLook(0, 1).reached, 0);
  assert.equal(dotLook(1.5, 2).reached, 0.5);
  assert.equal(checkLook(0, 3), 0);
  assert.equal(checkLook(2, 3), 1);
});

test('wheels: an odometer, the tens wheel turning only while the ones roll over', () => {
  assert.deepEqual(wheels(62), { tens: 6, ones: 2 });
  assert.equal(wheels(68.5).tens, 6);
  assert.ok(Math.abs(wheels(69.5).tens - 6.5) < 1e-9);
  assert.ok(maxJump((v) => wheels(v).tens, 50, 80) < 0.02);
});

test('demo data: answers follow the clip; the skills read back as the Skills tab would show them', () => {
  assert.equal(GAME_CALLS.length, 2);
  assert.ok(isRight(answer('ai', 'ai')));
  assert.ok(!isRight(answer('real', 'ai')));
  assert.equal(answer('real', 'ai', 'Uploaded 2016').why, 'Uploaded 2016');
  const d = demoSkills();
  assert.deepEqual(toScore(d.general.now), { score: 68, low: 61, high: 74 });
  assert.equal(toScore(d.general.before).score, 62);
  for (const c of DEMO_CATEGORIES) {
    const now = toScore(d.now[c]);
    assert.ok(now.low <= now.score && now.score <= now.high && now.high <= 100, c);
    assert.ok(toScore(d.before[c]).score <= now.score, `${c} doesn't drop`);
  }
  const st = demoSkillState();
  assert.equal(toScore(st.overall).score, 68);
  assert.equal(st.history.at(-1), 68, 'its line ends at the score');
  assert.ok(st.stats.correct <= st.stats.answers && st.stats.bestStreak >= st.stats.streak);
});
