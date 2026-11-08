/**
 * Runs the review's Python tests (test_review.py) under `npm test`: the decisions
 * fold the feed build reads, and build_media's --exclude-discarded pruning. Offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('review Python tests pass', () => {
  const r = spawnSync('python3', ['-I', resolve(import.meta.dirname, 'test_review.py')], { encoding: 'utf8' });
  assert.equal(r.error, undefined, `python3 not runnable: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
});
