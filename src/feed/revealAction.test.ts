import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipExplanation } from './revealAction.ts';
import { parseSettings } from '../devtools/settings.ts';

const real = { verdict: 'real' as const, author: 'fieldnotes', sourceUrl: 'https://example.test/clip' };
test('real clips confirm their source, even if they have an annotation file', () => {
  assert.deepEqual(clipExplanation(real, 'toast'), { kind: 'toast', text: 'Real · from @fieldnotes' });
  assert.equal(clipExplanation({ ...real, tellsUrl: 'tells.json' }, 'toast').kind, 'toast');
  assert.deepEqual(clipExplanation({ ...real, sourceUrl: undefined }, 'toast'), { kind: 'toast', text: "This one's real" });
  assert.deepEqual(clipExplanation({ ...real, author: 'unknown' }, 'toast'), { kind: 'toast', text: "This one's real" });
});
test('hide eye suppresses real-clip reveals; Game keeps its existing walkthrough policy', () => {
  assert.equal(clipExplanation(real, 'hideEye').kind, 'none');
  assert.equal(clipExplanation(real, 'toast', true).kind, 'none');
  assert.equal(clipExplanation({ ...real, tellsUrl: 'tells.json' }, 'toast', true).kind, 'walkthrough');
});
test('AI walkthroughs stay available; clips without one have an honest fallback', () => {
  assert.equal(clipExplanation({ ...real, verdict: 'ai', tellsUrl: 'tells.json' }, 'hideEye').kind, 'walkthrough');
  assert.deepEqual(clipExplanation({ author: 'unknown' }, 'toast'), { kind: 'toast', text: 'No walkthrough for this clip yet' });
});
test('real clips default to toast and the comparison mode persists', () => {
  assert.equal(parseSettings(null).realClips, 'toast');
  assert.equal(parseSettings('{"realClips":"hideEye"}').realClips, 'hideEye');
  assert.equal(parseSettings('{"realClips":"bad"}').realClips, 'toast');
});
