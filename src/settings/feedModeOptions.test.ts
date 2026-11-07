import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEED_MODES } from './settings.ts';
import { feedModeOptions, revealVerb } from './feedModeOptions.ts';

test('revealVerb follows the dev gesture and the layout', () => {
  assert.equal(revealVerb('hold', false), 'Hold');
  assert.equal(revealVerb('hold', true), 'Click and hold');
  assert.equal(revealVerb('doubleTap', false), 'Double-tap');
  assert.equal(revealVerb('doubleTap', true), 'Double-click');
});

test('feedModeOptions lists every mode once, in order', () => {
  assert.deepEqual(
    feedModeOptions('hold', false).map((o) => o.id),
    [...FEED_MODES],
  );
});

test('the reveal wording follows the gesture', () => {
  const [hold, holdAuto] = feedModeOptions('hold', false);
  assert.match(hold.description, /^No labels\. Hold a clip /);
  assert.match(holdAuto.description, /Hold to see the reasoning/);
  const [tap, tapAuto] = feedModeOptions('doubleTap', true);
  assert.match(tap.description, /Double-click a clip /);
  assert.match(tapAuto.description, /Double-click to see the reasoning/);
});
