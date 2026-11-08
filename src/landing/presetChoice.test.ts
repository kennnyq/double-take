import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANDING_PRESET, LANDING_PRESETS } from './designs.ts';
import { choosePreset } from './presetChoice.ts';

const ids = (p: { id: string }) => p.id;

test('the landing defaults to Tilted plane, and the bar keeps its order', () => {
  assert.equal(DEFAULT_LANDING_PRESET, 'tilted');
  const preset = choosePreset(LANDING_PRESETS, { fallback: DEFAULT_LANDING_PRESET });
  assert.equal(preset.label, 'Tilted plane');
  assert.equal(preset.values.gallery, 'tilted');
  assert.deepEqual(LANDING_PRESETS.slice(0, 3).map(ids), ['marquee', 'columns', 'tilted']);
});

test('the address beats the last design shown, which beats the default', () => {
  const pick = (fromUrl: string | null, stored: string | null) =>
    choosePreset(LANDING_PRESETS, { fromUrl, stored, fallback: DEFAULT_LANDING_PRESET }).id;
  assert.equal(pick('orbit', 'columns'), 'orbit');
  assert.equal(pick(null, 'columns'), 'columns');
  assert.equal(pick(null, null), 'tilted');
  // Unknown ids (a renamed preset, a typo) fall through.
  assert.equal(pick('nope', 'gone'), 'tilted');
});

test('without a known default, the first preset', () => {
  assert.equal(choosePreset(LANDING_PRESETS, {}).id, 'marquee');
  assert.equal(choosePreset(LANDING_PRESETS, { fallback: 'nope' }).id, 'marquee');
});
