/**
 * Runs the harvest's Python tests (test_harvest.py) under `npm test`, so the note
 * classifier and the tier labels are checked with everything else. Offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('harvest Python tests pass', () => {
  const r = spawnSync('python3', ['-I', resolve(import.meta.dirname, 'test_harvest.py')], { encoding: 'utf8' });
  assert.equal(r.error, undefined, `python3 not runnable: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
});

test('review publish Python tests pass', () => {
  const r = spawnSync('python3', ['-I', resolve(import.meta.dirname, 'test_review_publish.py')], { encoding: 'utf8' });
  assert.equal(r.error, undefined, `python3 not runnable: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
});
