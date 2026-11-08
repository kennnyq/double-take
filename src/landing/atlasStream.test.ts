import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopPlan, splitFragmented } from './atlasStream.ts';

/** A top-level MP4 box: 32-bit size, type, then `body` bytes. */
function box(type: string, body = 4): Uint8Array {
  const b = new Uint8Array(8 + body);
  new DataView(b.buffer).setUint32(0, b.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  return b;
}
function file(...boxes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(boxes.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of boxes) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
const types = (bytes: Uint8Array) => {
  const out: string[] = [];
  for (let at = 0; at < bytes.length; at += new DataView(bytes.buffer, bytes.byteOffset).getUint32(at))
    out.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
  return out;
};

test('splitFragmented: init boxes, then the media, without the trailing index', () => {
  const parts = splitFragmented(file(box('ftyp'), box('moov', 40), box('moof', 20), box('mdat', 100), box('mfra', 8)))!;
  assert.deepEqual(types(parts.init), ['ftyp', 'moov']);
  assert.deepEqual(types(parts.media), ['moof', 'mdat']);
});

test('splitFragmented keeps every fragment', () => {
  const parts = splitFragmented(file(box('ftyp'), box('moov'), box('moof'), box('mdat'), box('moof'), box('mdat')))!;
  assert.deepEqual(types(parts.media), ['moof', 'mdat', 'moof', 'mdat']);
});

test('splitFragmented refuses what Media Source could not loop', () => {
  // A plain (faststart) MP4.
  assert.equal(splitFragmented(file(box('ftyp'), box('moov'), box('mdat'))), null);
  // Truncated.
  assert.equal(splitFragmented(file(box('ftyp'), box('moov'), box('moof')).subarray(0, 30) as Uint8Array<ArrayBuffer>), null);
  assert.equal(splitFragmented(new Uint8Array(0)), null);
});

test('loopPlan appends the next copy right after the last, before it runs out', () => {
  // Two copies buffered (to 14 s), 3 s in: plenty left.
  assert.deepEqual(loopPlan(3, 2, 7, 0), { append: false, offset: 14, dropTo: null });
  // 4.4 s left, under 1.5 loops' margin: the third copy goes on at 14.
  assert.deepEqual(loopPlan(9.6, 2, 7, 7), { append: true, offset: 14, dropTo: null });
  assert.equal(loopPlan(0, 0, 7, null).append, true);
});

test('loopPlan drops only whole copies that are behind', () => {
  // Still in the first copy: nothing is behind.
  assert.equal(loopPlan(6.9, 3, 7, 0).dropTo, null);
  // Inside the second: the first (0-7) is all behind.
  assert.equal(loopPlan(9, 3, 7, 0).dropTo, 7);
  // Inside the third: up to its start (14), never into the copy playing.
  assert.equal(loopPlan(15, 3, 7, 0).dropTo, 14);
  assert.equal(loopPlan(15, 3, 7, 14).dropTo, null);
});
