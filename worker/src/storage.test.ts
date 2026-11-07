import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceStream } from './storage.ts';

const DATA = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

/** A stream of DATA in chunks of the given sizes (the last chunk takes the rest). */
function chunked(sizes: number[]): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  for (const s of sizes) {
    chunks.push(DATA.slice(pos, pos + s));
    pos += s;
  }
  if (pos < DATA.length) chunks.push(DATA.slice(pos));
  return new ReadableStream({
    pull(c) {
      const next = chunks.shift();
      if (next) c.enqueue(next);
      else c.close();
    },
  });
}

async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const cases: [string, number[], number, number][] = [
  ['range inside one chunk', [100, 100, 800], 120, 150],
  ['range across chunk boundaries', [100, 100, 800], 50, 450],
  ['range starting on a boundary', [100, 100, 800], 200, 299],
  ['first two bytes (AVPlayer probe)', [64, 936], 0, 1],
  ['tail of the file', [300, 300, 400], 900, 999],
  ['whole file', [10, 990], 0, 999],
  ['one-byte chunks', Array(1000).fill(1), 3, 7],
];

for (const [name, sizes, start, end] of cases) {
  test(`sliceStream: ${name}`, async () => {
    assert.deepEqual(await collect(sliceStream(chunked(sizes), start, end)), DATA.slice(start, end + 1));
  });
}

test('sliceStream stops reading the source once the range is done', async () => {
  let pulls = 0;
  let cancelled = false;
  const src = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      c.enqueue(new Uint8Array(100));
    },
    cancel() {
      cancelled = true;
    },
  });
  const out = await collect(sliceStream(src, 0, 149));
  assert.equal(out.length, 150);
  assert.ok(cancelled, 'source should be cancelled');
  assert.ok(pulls <= 3, `read ${pulls} chunks for a 150-byte range`);
});
