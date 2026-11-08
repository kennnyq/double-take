import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientServiceError, isServiceUnavailable, responseError, serviceConfig, serviceRequest, serviceUrl, validateJobResponse, withRequestTimeout } from './client-config.ts';

test('explicit configuration only; production requires HTTPS and rejects credentials or URL suffixes', () => {
  for (const value of [undefined, '', '   ']) assert.deepEqual(serviceConfig(value, true), { available: false, reason: 'missing' });
  for (const value of ['relative', '//service.example', 'file:///tmp/jobs', 'https://user:password@service.example', 'https://service.example/?token=secret', 'https://service.example/#route']) assert.equal(serviceConfig(value, true).available, false);
  assert.deepEqual(serviceConfig('http://localhost:8790', true), { available: false, reason: 'https_required' });
  assert.equal(serviceUrl(serviceConfig('http://localhost:8790/', false), '/jobs/a'), 'http://localhost:8790/jobs/a');
  assert.equal(serviceUrl(serviceConfig(' https://service.example/api/// ', true), '/jobs/a'), 'https://service.example/api/jobs/a');
});
test('unavailable config never invokes transport, including an upload callback', async () => {
  let calls = 0;
  await assert.rejects(serviceRequest(serviceConfig(undefined, true), '/jobs/a', async () => { calls++; return {}; }), error => isServiceUnavailable(error) && error.code === 'unconfigured');
  assert.equal(calls, 0);
});
test('timeout aborts stalled fetch/body even if transport ignores cancellation', async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(withRequestTimeout(async s => { signal = s; return new Promise(() => {}); }, 10), error => isServiceUnavailable(error) && error.code === 'timeout');
  assert.equal(signal?.aborted, true);
  await assert.rejects(withRequestTimeout(async s => { signal = s; await Promise.resolve({ status: 200 }); return new Promise(() => {}); }, 10), /timed out/);
  assert.equal(signal?.aborted, true);
});
test('success clears timer; network errors become recoverable copy without leaking internals', async () => {
  let signal: AbortSignal | undefined;
  assert.equal(await withRequestTimeout(async s => { signal = s; return 42; }, 10), 42);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal?.aborted, false);
  await assert.rejects(withRequestTimeout(async () => { throw new Error('private host diagnostics'); }), error => isServiceUnavailable(error) && !error.message.includes('private'));
  const rejected = new ClientServiceError('rejected', 'Choose a smaller video.');
  await assert.rejects(withRequestTimeout(async () => { throw rejected; }), error => error === rejected);
});
test('HTTP outages stay friendly; persisted validation failures require matching recovery key', () => {
  for (const status of [401, 403, 408, 429, 500, 503]) assert.equal(isServiceUnavailable(responseError(status, { error: 'internal detail' }, 'fallback')), true);
  const saved = { code: 'duration_exceeded', requestId: 'same-key', error: 'Choose a video up to 60 seconds.' };
  assert.equal(responseError(404, saved, 'Not saved.', 'same-key').message, saved.error);
  assert.equal(responseError(404, saved, 'Not saved.', 'other-key').message, 'Not saved.');
  assert.equal(responseError(404, null, 'Not saved.').message, 'Not saved.');
});
test('fresh results bind request id and media hash; prepared revisions preserve their source clip identity', () => {
  const id = 'a'.repeat(64), sha256 = 'b'.repeat(64);
  const result = { version: 1, clipId: id, mediaSha256: sha256, components: [], evidence: [] };
  const job = { id, state: 'complete', sha256, result };
  assert.doesNotThrow(() => validateJobResponse(job, id));
  assert.doesNotThrow(() => validateJobResponse({ id, state: 'queued' }, id));
  for (const bad of [null, { ...job, id: 'wrong' }, { ...job, state: 'running' }, { ...job, result: undefined }, { ...job, sha256: 'c'.repeat(64) }, { ...job, result: { ...result, clipId: 'other' } }]) assert.throws(() => validateJobResponse(bad, id), /result unavailable/);
  assert.doesNotThrow(() => validateJobResponse({ ...job, result: { ...result, clipId: 'source-clip' } }, id, true));
  assert.throws(() => validateJobResponse({ ...job, sha256: 'wrong' }, id, true));
});
test('optional verdict rejects malformed headlines before desktop or native rendering', () => {
  const id = 'a'.repeat(64), sha256 = 'b'.repeat(64);
  const result = { version: 1, clipId: id, mediaSha256: sha256, components: [], evidence: [] };
  const check = (verdict: unknown) => validateJobResponse({ id, state: 'complete', sha256, result: { ...result, verdict } }, id);
  assert.doesNotThrow(() => check(undefined));
  for (const label of ['likely_ai', 'likely_real']) {
    assert.doesNotThrow(() => check({ label, drivers: ['A bound visual check drives this call.'] }));
    assert.doesNotThrow(() => check({ label, drivers: [], confidence: .7, calibration: { version: 'fixture', scope: 'feed-domain' } }));
  }
  for (const verdict of [null, { label: 'likely_ai' }, { label: 'likely_ai', drivers: [null] },
    { label: 'bogus', drivers: [] }, { label: ['likely_ai'], drivers: [] }, { label: 'likely_real', drivers: [], confidence: 'oops' },
    ...[-1, 1.1, NaN, Infinity, .7].map(confidence => ({ label: 'likely_ai', drivers: [], confidence })),
    { label: 'likely_ai', drivers: [''] }, { label: 'likely_ai', drivers: ['x'.repeat(401)] },
    { label: 'likely_ai', drivers: Array(9).fill('detail') }]) assert.throws(() => check(verdict), /result unavailable/);
});
