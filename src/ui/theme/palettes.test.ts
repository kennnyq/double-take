import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PALETTE,
  PALETTES,
  hexToRgb,
  PALETTE_IDS,
  contrast,
  cssVariables,
  difference,
  parsePaletteId,
  type Vision,
} from './palettes.ts';

const AA_TEXT = 4.5;
const AA_UI = 3;
/** The Not AI chip (black at 55%) over mid-grey footage. */
const REAL_CHIP_ON_VIDEO = '#373737';
/** Small enough apart that people with these kinds of vision can still tell them apart. */
const VISIONS: Vision[] = ['normal', 'protan', 'deutan'];
const DISTINCT = 12;

for (const id of PALETTE_IDS) {
  const p = PALETTES[id];

  test(`${id}: text on its fills meets WCAG AA`, () => {
    assert.ok(contrast(p.accent, p.onAccent) >= AA_TEXT, 'onAccent on accent');
    assert.ok(contrast(p.ai, p.onAi) >= AA_TEXT, 'onAi on ai');
    assert.ok(contrast(p.tell, p.onTell) >= AA_TEXT, 'onTell on tell');
    for (const bg of [p.bg, p.surface, p.surfaceRaised]) {
      assert.ok(contrast(p.text, bg) >= AA_TEXT, `text on ${bg}`);
      assert.ok(contrast(p.textDim, bg) >= AA_TEXT, `textDim on ${bg}`);
    }
  });

  test(`${id}: controls and focus rings stand out (AA, non-text)`, () => {
    for (const bg of [p.bg, p.surface]) {
      assert.ok(contrast(p.accent, bg) >= AA_UI, `accent on ${bg}`);
      assert.ok(contrast(p.focus, bg) >= AA_UI, `focus on ${bg}`);
    }
  });

  test(`${id}: the AI chip is set apart from the Not AI chip by lightness, not hue alone`, () => {
    assert.ok(contrast(p.ai, REAL_CHIP_ON_VIDEO) >= AA_UI);
  });

  test(`${id}: AI and the tells don't look like a like or a repost`, () => {
    for (const v of VISIONS) {
      for (const c of [p.ai, p.tell]) {
        assert.ok(difference(c, p.like, v) >= DISTINCT, `${c} vs like (${v})`);
        assert.ok(difference(c, p.repost, v) >= DISTINCT, `${c} vs repost (${v})`);
      }
    }
  });
}

test('only the old palette is yellow', () => {
  const yellow = PALETTES.yellow.accent;
  for (const id of PALETTE_IDS.filter((i) => i !== 'yellow')) {
    for (const c of [PALETTES[id].accent, PALETTES[id].ai, PALETTES[id].tell]) {
      const rgb = hexToRgb(c);
      const grey = Math.max(...rgb) - Math.min(...rgb) < 0.1;
      assert.ok(grey || difference(c, yellow) > 25, `${id} ${c}`);
    }
  }
});

test('parsePaletteId falls back to the default', () => {
  assert.equal(parsePaletteId('glacier'), 'glacier');
  assert.equal(parsePaletteId('nope'), DEFAULT_PALETTE);
  assert.equal(parsePaletteId(null), DEFAULT_PALETTE);
});

test('cssVariables names every colour in kebab case', () => {
  const vars = cssVariables(PALETTES.mono);
  assert.equal(vars['--dt-on-accent'], PALETTES.mono.onAccent);
  assert.equal(vars['--dt-surface-raised'], PALETTES.mono.surfaceRaised);
  assert.ok(!('--dt-id' in vars) && !('--dt-name' in vars));
});
