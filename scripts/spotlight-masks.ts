/**
 * Writes the double take spotlight's soft-hole images (assets/spotlight/).
 *
 *   node scripts/spotlight-masks.ts
 *
 * Each image is SIZE×SIZE with the shape filling the central BOX×BOX square,
 * its edge softened across a feather. `hole-*` is black outside the shape and
 * clear inside (the native dimming layer, scaled with transforms); `spot-*` is
 * the opposite (a CSS mask the web layers exclude). Scaling one prepared image
 * on the GPU replaces drawing the hole again every frame.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { MASK_BOX, MASK_SIZE, MASK_SHAPES, type MaskShape } from '../src/feed/spotlight.ts';

/** Signed distance (px, negative inside) from the shape's edge, in box coordinates centred on 0. */
function distance(shape: MaskShape, x: number, y: number): number {
  const a = MASK_BOX / 2;
  if (shape.kind === 'ellipse') return Math.hypot(x, y) - a;
  // Rounded rectangle.
  const r = shape.radius;
  const qx = Math.abs(x) - (a - r);
  const qy = Math.abs(y) - (a - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A black RGBA PNG whose alpha is `alpha(x, y)`. */
function png(size: number, alpha: (x: number, y: number) => number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) raw[row + 1 + x * 4 + 3] = Math.round(255 * alpha(x, y));
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'spotlight');
mkdirSync(out, { recursive: true });
for (const [name, shape] of Object.entries(MASK_SHAPES)) {
  const inside = (x: number, y: number) => {
    const d = distance(shape, x + 0.5 - MASK_SIZE / 2, y + 0.5 - MASK_SIZE / 2);
    return 1 - smoothstep(-shape.feather / 2, shape.feather / 2, d);
  };
  writeFileSync(join(out, `hole-${name}.png`), png(MASK_SIZE, (x, y) => 1 - inside(x, y)));
  writeFileSync(join(out, `spot-${name}.png`), png(MASK_SIZE, inside));
  console.log(`wrote hole-${name}.png and spot-${name}.png`);
}
