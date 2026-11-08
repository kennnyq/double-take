import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpaceRecognizer } from './spaceGesture.ts';
import { DOUBLE_TAP_MS } from './gesture.ts';
import type { RevealGesture } from './settings.ts';

function setup(mode: RevealGesture = 'both', hasTells = true) {
  let now = 0, id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const log: string[] = [];
  const r = createSpaceRecognizer({
    set(fn, ms) { due.set(++id, { at: now + ms, fn }); return id; },
    clear(k) { due.delete(k as number); },
  }, () => now);
  const advance = (ms: number) => {
    const end = now + ms;
    while (true) {
      const entry = [...due].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      now = entry[1].at; due.delete(entry[0]); entry[1].fn();
    }
    now = end;
  };
  const press = { mode, hasTells, holdMs: 400, onSingle: () => log.push('advance'), onReveal: () => log.push('reveal') };
  return { r, log, advance, down: () => r.down(press), tap: () => { r.down(press); r.up(); } };
}

for (const mode of ['doubleTap', 'both'] as const) {
  test(mode + ': first press waits; second press reveals without advancing', () => {
    const s = setup(mode); s.tap(); s.advance(100);
    assert.deepEqual(s.log, []);
    s.down(); s.r.up(); s.advance(1000);
    assert.deepEqual(s.log, ['reveal']);
  });
  test(mode + ': a single tap advances at the shared deadline, not later', () => {
    const s = setup(mode); s.down(); s.advance(100); s.r.up();
    s.advance(DOUBLE_TAP_MS - 101); assert.deepEqual(s.log, []);
    s.advance(1); assert.deepEqual(s.log, ['advance']);
  });
}
test('Hold mode does not reserve a double-tap window', () => {
  const s = setup('hold'); s.tap(); assert.deepEqual(s.log, ['advance']);
  s.advance(100); s.tap(); assert.deepEqual(s.log, ['advance', 'advance']);
});
test('held Space and auto-repeats reveal only once, never advance', () => {
  for (const mode of ['hold', 'both'] as const) {
    const s = setup(mode); s.down();
    for (let i = 0; i < 12; i++) { s.advance(50); s.down(); }
    s.r.up(); s.advance(1000); assert.deepEqual(s.log, ['reveal']);
  }
});
test('Double tap mode does not reveal on hold, and advances once on release', () => {
  const s = setup('doubleTap'); s.down(); s.advance(800); s.down();
  assert.deepEqual(s.log, []); s.r.up(); assert.deepEqual(s.log, ['advance']);
});
test('clips without annotations advance immediately in all modes', () => {
  for (const mode of ['hold', 'doubleTap', 'both'] as const) {
    const s = setup(mode, false); s.down(); assert.deepEqual(s.log, ['advance']);
    s.advance(1000); s.down(); s.r.up(); assert.deepEqual(s.log, ['advance']);
  }
});
test('cancelling on navigation, typing, blur or settings changes discards pending actions', () => {
  const s = setup(); s.tap(); s.advance(100); s.r.cancel(); s.advance(1000);
  assert.deepEqual(s.log, []);
  s.down(); s.advance(100); s.r.cancel(); s.advance(1000); s.r.up();
  assert.deepEqual(s.log, []);
});
test('taps at the window boundary are separate advances', () => {
  const s = setup(); s.tap(); s.advance(DOUBLE_TAP_MS); s.tap(); s.advance(DOUBLE_TAP_MS);
  assert.deepEqual(s.log, ['advance', 'advance']);
});
