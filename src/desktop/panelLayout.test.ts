import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_ROOM, PANEL_GAP, PANEL_MAX, panelLayout } from './panelLayout.ts';

const ACTIONS = 104;

describe('panelLayout', () => {
  it('docks beside the action column without moving the clip when there is room', () => {
    const l = panelLayout(1900, 464, ACTIONS);
    assert.equal(l.shift, 0);
    assert.equal(l.overlay, false);
    assert.equal(l.width, PANEL_MAX);
    assert.equal(l.left, 950 + 232 + ACTIONS + PANEL_GAP);
  });

  it('slides the feed left just enough to fit the panel and the up/down buttons', () => {
    // 1512x857 window: 1440 beside the rail, a 464px card.
    const l = panelLayout(1440, 464, ACTIONS);
    assert.equal(l.overlay, false);
    assert.ok(l.shift > 0);
    assert.equal(l.left + l.width, 1440 - NAV_ROOM);
    assert.equal(l.compact, false);
  });

  it('moves the author into the card when the left column gets too narrow', () => {
    // 1280x800 window.
    const l = panelLayout(1208, 432, ACTIONS);
    assert.equal(l.overlay, false);
    assert.equal(l.compact, true);
    assert.ok(l.left + l.width <= 1208 - NAV_ROOM);
  });

  it('lays the panel over the right edge when it cannot dock', () => {
    const l = panelLayout(700, 432, ACTIONS);
    assert.equal(l.overlay, true);
    assert.equal(l.shift, 0);
    assert.equal(l.left + l.width, 700 - 16);
  });
});
