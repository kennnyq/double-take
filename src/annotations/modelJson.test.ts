import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionText, extractJson, ModelJsonError } from './modelJson.ts';

test('clean JSON passes through with no repairs', () => {
  assert.deepEqual(extractJson('{"tells":[]}'), { value: { tells: [] }, repairs: [] });
  assert.deepEqual(extractJson('  [1,2] ').value, [1, 2]);
  // Already-parsed objects (some SDKs) are accepted as is.
  assert.deepEqual(extractJson({ tells: [] }).value, { tells: [] });
});

test('reasoning blocks, fences, prose and trailing commas are stripped and reported', () => {
  const r = extractJson('<think>let me look… {"no": 1}</think>\nSure! Here it is:\n```json\n{"tells": [{"a": 1,},],}\n```\nHope that helps.');
  assert.deepEqual(r.value, { tells: [{ a: 1 }] });
  assert.ok(r.repairs.includes('removed <think> block'));
  assert.ok(r.repairs.includes('removed code fence'));
  assert.ok(r.repairs.includes('removed trailing commas'));
});

test('braces inside strings do not confuse the bracket matcher', () => {
  const r = extractJson('Result: {"label": "sign says \\"}{\\" twice", "n": [1]} trailing');
  assert.deepEqual(r.value, { label: 'sign says "}{" twice', n: [1] });
  assert.ok(r.repairs.includes('ignored text after the JSON'));
});

test('unrecoverable replies throw a ModelJsonError saying why', () => {
  const cases: [unknown, RegExp][] = [
    ['', /empty/],
    [null, /no text/],
    ['I cannot help with that.', /no JSON/],
    ['{"tells": [{"label": "cut off', /cut off/],
    ['<think>still thinking about the frames', /unfinished <think>/],
    ['{"a": nope}', /does not parse/],
  ];
  for (const [input, re] of cases) {
    assert.throws(() => extractJson(input), (e: unknown) => e instanceof ModelJsonError && re.test((e as Error).message), String(input));
  }
});

test('completionText reads content, then reasoning_content, else null', () => {
  assert.equal(completionText({ choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
  assert.equal(completionText({ choices: [{ message: { content: '', reasoning_content: 'x' } }] }), 'x');
  // Real PoC failure: reasoning runs that hit the token limit returned content: null.
  assert.equal(completionText({ choices: [{ message: { content: null } }] }), null);
  assert.equal(completionText({}), null);
});
