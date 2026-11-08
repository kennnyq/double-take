import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEED_MODES } from './settings.ts';
import { feedModeOptions } from './feedModeOptions.ts';

test('feedModeOptions lists every mode once, in order', () => {
  assert.deepEqual(
    feedModeOptions('hold', false).map((o) => o.id),
    [...FEED_MODES],
  );
});

test('the reveal wording names the button and the picked gestures for the layout', () => {
  const [hold, holdAuto] = feedModeOptions('hold', false);
  assert.match(hold.description, /^No labels\. Tap Double take, or hold a clip, /);
  assert.match(holdAuto.description, /or hold a clip, for the reasoning/);
  const [both] = feedModeOptions('both', true);
  assert.match(both.description, /or hold Space or double-click, to see/);
});
