/*
 * Clip review (dev only): one clip at a time, presented the way the app presents it.
 * The double take (spotlight, card placement, eased scrubbing, step order, replay
 * loops, palette) runs on the app's own modules, served type-stripped under /app/.
 */
/* eslint-disable import/no-unresolved -- /app/ URLs are served by scripts/review/server.ts, not files on disk */
import { grow, holeFor, maskFor, maskPlacement, paddingPx, spotlightStrength } from '/app/src/feed/spotlight.ts';
import { cardSpot, emptierSide, estimateCardHeight } from '/app/src/feed/card.ts';
import { easedSeek, planScrub, runScrub, safeSeek } from '/app/src/feed/scrub.ts';
import { boxOnStage, fitFor, videoRect } from '/app/src/feed/tells.ts';
import { readTellsFile } from '/app/src/annotations/format.ts';
import { REPLAY_RATE, activeTells, boxShownAt, replayWindow, seekTimeFor, walkthroughSteps } from '/app/src/annotations/walkthrough.ts';
import { DEFAULT_PALETTE, PALETTES, cssVariables } from '/app/src/ui/theme/palettes.ts';
import { DEFAULT_FILTER, buildQueue, decided, nextIndex, sourceId, sourceOptions } from '/app/scripts/review/web/queue.ts';
import { clock, markers, runLabel, stepFrom, tellRef } from '/app/scripts/review/web/timeline.ts';

// The app's defaults (src/devtools/settings.ts): feathered spotlight, darken, medium strength.
const SHAPE = 'feather';
const PAD = paddingPx('normal');
const { dim: DIM } = spotlightStrength(2, false);
const MASK = `url("/app/assets/spotlight/spot-${maskFor(SHAPE)}.png"), linear-gradient(#000, #000)`;
/** The app keeps the card clear of the top bar and Close button (TellOverlay: top + 46). */
const SAFE_TOP = 46;
const SAFE_BOTTOM = 20;

for (const [k, v] of Object.entries(cssVariables(PALETTES[DEFAULT_PALETTE]))) document.documentElement.style.setProperty(k, v);

// ---------------------------------------------------------------- helpers
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`review2.${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`review2.${k}`, JSON.stringify(v));
    } catch {
      // private mode
    }
  },
};
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  return out;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}
const fmtNum = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  done: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
};

// ---------------------------------------------------------------- state
const S = {
  items: [],
  byKey: new Map(),
  feeds: [],
  batches: [],
  states: {},
  vetted: new Set(),
  sourceOrder: [],
  filter: { ...DEFAULT_FILTER, ...store.get('filter', {}) },
  queue: [],
  i: 0,
  key: null,
  /** Annotation runs of the current clip: [{ name, url, file }] (file null while loading or missing). */
  runs: [],
  run: 0,
  preferredRun: store.get('run', 'main'),
  dt: { on: false, step: -1, steps: [], unplaced: [], replay: null },
  outlines: store.get('outlines', false),
  /** live: the selected run's annotations appear as the clip plays; step: only in the double take. */
  mode: store.get('mode', 'live'),
  /** The annotation shown live right now (its ref), null for none, undefined to re-check (run, mode or marks changed). */
  live: null,
  /** The reviewer itself is moving the video (eased seek, drag, step scrub): not a user pause. */
  scrubbing: false,
  gridSort: store.get('gridSort', 'time'),
  muted: true,
  by: store.get('by', 'kenny'),
  undo: [],
};
const video = $('#video');
const stage = $('#stage');
let cancelScrub = () => {};

// ---------------------------------------------------------------- geometry
function stageSize() {
  return { W: stage.clientWidth, H: stage.clientHeight };
}
function current() {
  return S.byKey.get(S.key);
}
function aspectOf(it) {
  const m = it?.media;
  return m && m.width && m.height ? m.width / m.height : video.videoWidth ? video.videoWidth / video.videoHeight : 9 / 16;
}
function frameRect() {
  const { W, H } = stageSize();
  const a = aspectOf(current());
  return videoRect(W, H, a, fitFor(a));
}
function areaOf(tell) {
  if (!tell?.box) return null;
  const { W, H } = stageSize();
  return boxOnStage(tell.box, frameRect(), W, H);
}
const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : current()?.media?.duration || 0);
const runTells = (i = S.run) => S.runs[i]?.file?.tells ?? [];
/** The reviewer's mark on an annotation of the current clip ({pick, note}), if any. */
const markOf = (run, tell) => S.states[S.key]?.tells?.[tellRef(run, tell.id)];

// ---------------------------------------------------------------- data
const tellsCache = new Map();
function loadTellsFile(url) {
  if (!tellsCache.has(url))
    tellsCache.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d ? readTellsFile(d) : null))
        .catch(() => null),
    );
  return tellsCache.get(url);
}

async function load(refresh = false) {
  const [cat, dec] = await Promise.all([api(`/api/catalog${refresh ? '?refresh=1' : ''}`), api('/api/decisions')]);
  S.items = cat.items;
  S.byKey = new Map(S.items.map((i) => [i.key, i]));
  S.feeds = cat.feeds;
  S.batches = cat.batches;
  S.states = dec.states;
  S.vetted = new Set(dec.vetted || []);
  S.sourceOrder = [
    ...cat.feeds.filter((f) => f.ok).map((f) => `feed:${f.source}/${f.name}`),
    ...cat.batches.map((b) => `batch:${b.name}`),
  ];
}

function rebuildQueue(keepKey) {
  S.queue = buildQueue(S.items, S.states, S.vetted, S.filter, S.sourceOrder);
  const i = keepKey ? S.queue.indexOf(keepKey) : -1;
  S.i = i >= 0 ? i : 0;
  renderQueueLabel();
}

function renderQueueLabel() {
  const f = S.filter;
  const parts = [{ unreviewed: 'Unreviewed', keep: 'Kept', discard: 'Dropped', all: 'All' }[f.status]];
  if (f.source !== 'all') parts.push(f.source.replace(/^(feed|batch):/, ''));
  if (f.vetted !== 'any') parts.push(f.vetted === 'vetted' ? 'worker-vetted' : 'not vetted');
  if (f.tells !== 'any') parts.push(f.tells === 'with' ? 'with tells' : 'no tells');
  $('#queue-label').textContent = parts.join(' · ');
  const inQueue = S.queue.indexOf(S.key);
  $('#pos').textContent = S.queue.length ? `${inQueue >= 0 ? inQueue + 1 : '–'} / ${S.queue.length}` : '0';
}

// ---------------------------------------------------------------- clip (navigation cuts; everything else moves)
async function openClip(key) {
  const it = S.byKey.get(key);
  cancelScrub();
  resetDoubleTake();
  S.live = null;
  S.scrubbing = false;
  S.key = key || null;
  history.replaceState(null, '', key ? `#${encodeURIComponent(key)}` : '#');
  renderQueueLabel();
  renderDecision();
  renderDrawer();
  $('#empty').hidden = !!it?.media;
  if (!it) {
    $('#empty').innerHTML = S.queue.length ? '' : 'Nothing in this queue.<br>Change the filters (F).';
    $('#empty').hidden = false;
    video.removeAttribute('src');
    video.load();
    S.runs = [];
    renderRuns();
    return;
  }
  if (!it.media) {
    $('#empty').innerHTML = `Not built yet, so there's no video.<br><a href="${esc(it.url)}" target="_blank" rel="noopener">Open the source</a>`;
    video.removeAttribute('src');
    video.load();
    S.runs = [];
    renderRuns();
    return;
  }
  const a = aspectOf(it);
  video.classList.toggle('contain', fitFor(a) === 'contain');
  video.poster = it.media.poster;
  video.src = it.media.video;
  video.loop = true;
  video.playbackRate = 1;
  video.muted = S.muted;
  video.play().catch(() => {});

  S.runs = it.media.tells.map((t) => ({ name: t.name, url: t.url, file: null }));
  const pick = S.runs.findIndex((r) => r.name === S.preferredRun);
  S.run = pick >= 0 ? pick : 0;
  renderRuns();
  await Promise.all(
    S.runs.map(async (r) => {
      r.file = await loadTellsFile(r.url);
    }),
  );
  if (S.key !== key) return;
  renderRuns();
  renderDrawer();
  if (gridOpen) renderGrid();
  prefetch(S.queue[S.i + 1]);
}

function prefetch(key) {
  const it = S.byKey.get(key);
  if (!it?.media) return;
  new Image().src = it.media.poster;
  for (const t of it.media.tells) loadTellsFile(t.url);
}

function go(delta) {
  if (!S.queue.length) return;
  const at = S.queue.indexOf(S.key);
  S.i = Math.max(0, Math.min(S.queue.length - 1, (at >= 0 ? at : S.i) + delta));
  saveNote();
  openClip(S.queue[S.i]);
}

// ---------------------------------------------------------------- runs (models) and the timeline
function renderRuns() {
  const box = $('#models');
  box.innerHTML = S.runs
    .map((r, i) => {
      const l = runLabel(r.name, r.file?.provenance?.models);
      const n = r.file ? r.file.tells.length : '…';
      return `<button role="tab" class="${i === S.run ? 'on' : ''}" data-run="${i}" title="${esc(l.model || r.name)} (${i + 1})">${esc(l.name)}<span class="n">${n}</span></button>`;
    })
    .join('');
  renderLanes();
  renderOutlines();
}

let laneEls = [];
function renderLanes() {
  const d = duration();
  const lanes = S.runs.map((r) => ({ name: r.name, tells: r.file?.tells ?? [] }));
  const ms = markers(lanes, d);
  $('#lanes').innerHTML = lanes
    .map(
      (l, li) =>
        `<div class="lane ${li === S.run ? 'on' : ''}" data-lane="${li}">${ms
          .filter((m) => m.lane === li)
          .map((m) => {
            const mark = markOf(S.runs[li].name, l.tells[m.tell]);
            return `<i class="mk${mark?.pick ? ' pick' : ''}" data-lane="${li}" data-tell="${m.tell}" style="left:${m.left * 100}%;width:${m.width * 100}%"></i>`;
          })
          .join('')}</div>`,
    )
    .join('');
  laneEls = [...document.querySelectorAll('#lanes .mk')];
}

function selectRun(i, { keepPlace = true } = {}) {
  if (i < 0 || i >= S.runs.length || i === S.run) return;
  S.run = i;
  S.live = undefined;
  S.preferredRun = S.runs[i].name;
  store.set('run', S.preferredRun);
  document.querySelectorAll('#models button').forEach((b) => b.classList.toggle('on', +b.dataset.run === i));
  document.querySelectorAll('#lanes .lane').forEach((l) => l.classList.toggle('on', +l.dataset.lane === i));
  renderOutlines();
  renderDrawer();
  if (S.dt.on && keepPlace) {
    // Stay where we are in the clip: the new run's step at or after the current frame.
    const steps = walkthroughSteps(runTells());
    if (!steps.length && !(S.runs[i].file?.unplaced ?? []).length) return exitDoubleTake();
    const t = video.currentTime;
    let at = steps.findIndex((x) => seekTimeFor(x) >= t - 0.15);
    if (at < 0) at = Math.max(0, steps.length - 1);
    startDoubleTake(at);
  }
}

$('#models').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-run]');
  if (b) selectRun(+b.dataset.run);
});

// Timeline: drag scrubs directly (the playhead follows the pointer); a tap eases there;
// a marker opens that run's tell in the double take.
const tl = $('#timeline');
let drag = null;
function timeAt(clientX) {
  const r = $('#track').getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration();
}
tl.addEventListener('pointerdown', (e) => {
  if (!current()?.media) return;
  drag = { x: e.clientX, moved: false, mk: e.target.closest('.mk'), wasPlaying: !video.paused };
  tl.setPointerCapture(e.pointerId);
});
tl.addEventListener('pointermove', (e) => {
  showTip(e);
  if (!drag) return;
  if (!drag.moved && Math.abs(e.clientX - drag.x) > 4) {
    drag.moved = true;
    cancelScrub();
    if (S.dt.on) exitDoubleTake(false);
    S.scrubbing = true;
    video.pause();
  }
  if (drag.moved) safeSeek(video, timeAt(e.clientX));
});
tl.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.moved) {
    S.scrubbing = false;
    if (d.wasPlaying) video.play().catch(() => {});
    return;
  }
  if (d.mk) {
    const lane = +d.mk.dataset.lane;
    const tell = runTells(lane)[+d.mk.dataset.tell];
    if (lane !== S.run) selectRun(lane, { keepPlace: false });
    const steps = walkthroughSteps(runTells());
    startDoubleTake(Math.max(0, steps.indexOf(tell)));
    return;
  }
  if (S.dt.on) exitDoubleTake(false);
  seekTo(timeAt(e.clientX));
});
tl.addEventListener('pointerleave', () => ($('#tip').hidden = true));

function showTip(e) {
  const mk = e.target.closest?.('.mk');
  const tip = $('#tip');
  if (!mk || drag?.moved) return void (tip.hidden = true);
  const tell = runTells(+mk.dataset.lane)[+mk.dataset.tell];
  if (!tell) return;
  const r = tl.getBoundingClientRect();
  tip.innerHTML = `<b>${esc(runLabel(S.runs[+mk.dataset.lane].name).name)}</b> · ${clock(tell.t0)}<br>${esc(tell.label)}`;
  tip.style.left = `${Math.max(120, Math.min(r.width - 120, e.clientX - r.left))}px`;
  tip.hidden = false;
}

/** Eased fast-forward/rewind (the app's scrub); playback resumes after. */
function seekTo(t) {
  cancelScrub();
  cancelScrub = easedSeek(video, t, (hold) => {
    S.scrubbing = hold;
    if (hold) video.pause();
    else video.play().catch(() => {});
  });
}

// ---------------------------------------------------------------- outlines (every run's boxes, for comparing)
let outlineEls = [];
function renderOutlines() {
  const host = $('#outlines');
  outlineEls = [];
  if (!S.outlines) return void (host.innerHTML = '');
  const parts = [];
  S.runs.forEach((r, ri) =>
    (r.file?.tells ?? []).forEach((t) => {
      const a = areaOf(t);
      if (!a) return;
      parts.push(
        `<div class="ol ${ri === S.run ? '' : 'other'}" style="left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px"><span>${esc(runLabel(r.name).name)} · ${esc(t.label)}</span></div>`,
      );
      outlineEls.push({ tell: t });
    }),
  );
  host.innerHTML = parts.join('');
  [...host.children].forEach((el, i) => (outlineEls[i].el = el));
}

// ---------------------------------------------------------------- the double take
const spot = { cur: null, target: null, on: 0, onTarget: 0 };
const spotEl = $('#spot');
spotEl.style.maskImage = MASK;
spotEl.style.setProperty('-webkit-mask-image', MASK);

function stepCount() {
  return S.dt.steps.length + (S.dt.unplaced.length ? 1 : 0);
}

function startDoubleTake(at = 0) {
  const file = S.runs[S.run]?.file;
  const steps = walkthroughSteps(file?.tells ?? []);
  const unplaced = file?.unplaced ?? [];
  if (!steps.length && !unplaced.length) return toast('No annotations in this run');
  S.dt = { on: true, step: -1, steps, unplaced, replay: null };
  stage.classList.add('dt');
  video.loop = false;
  goStep(at);
}

function exitDoubleTake(resume = true) {
  if (!S.dt.on) return;
  cancelScrub();
  S.dt = { on: false, step: -1, steps: [], unplaced: [], replay: null };
  S.live = null;
  stage.classList.remove('dt');
  spot.onTarget = 0;
  leaveCards();
  video.loop = true;
  video.playbackRate = 1;
  $('#step-label').textContent = '';
  if (resume) video.play().catch(() => {});
}

/** Navigation to another clip: drop the double take without its exit motion. */
function resetDoubleTake() {
  S.dt = { on: false, step: -1, steps: [], unplaced: [], replay: null };
  stage.classList.remove('dt');
  spot.cur = spot.target = null;
  spot.on = spot.onTarget = 0;
  spotEl.style.opacity = '0';
  $('#cards').innerHTML = '';
  $('#step-label').textContent = '';
}

function goStep(i) {
  const n = stepCount();
  if (i >= n) return exitDoubleTake();
  i = Math.max(0, i);
  const { W, H } = stageSize();
  const frame = frameRect();
  const tell = S.dt.steps[i];
  S.dt.step = i;
  cancelScrub();

  const area = areaOf(tell);
  const padded = area ? holeFor(area, SHAPE, PAD) : null;
  spot.target = padded;
  spot.onTarget = padded ? 1 : 0;
  if (padded && !spot.cur) spot.cur = { ...padded };

  const text = tell ? (tell.detail ?? tell.label) : S.dt.unplaced.slice(0, 3).map((u) => `“${u.quote}”`).join('\n');
  const others = S.dt.steps.map(areaOf).filter(Boolean);
  const width = Math.min(320, W - 24);
  const spotRect = cardSpot({
    hole: padded ? grow(padded, padded.feather / 2) : null,
    subject: area,
    placement: tell?.placement ?? emptierSide(frame, H, others),
    stageW: W,
    stageH: H,
    // The app's estimate, plus the line the reviewer's own mark adds.
    cardH: estimateCardHeight(text, width) + (tell && markOf(S.runs[S.run].name, tell) ? 24 : 0),
    safeTop: SAFE_TOP,
    safeBottom: SAFE_BOTTOM,
  });
  showCard(spotRect, text, { i, n, loop: !!tell, mark: tell ? markOf(S.runs[S.run].name, tell) : null });

  $('#step-label').textContent = `${runLabel(S.runs[S.run].name).name} · ${i + 1}/${n}`;
  markLane();

  if (tell) {
    const rep = replayWindow(tell, duration());
    S.dt.replay = rep;
    S.scrubbing = true;
    video.pause();
    const stop = runScrub(video, planScrub(video.currentTime, rep.from), () => {
      S.scrubbing = false;
      video.playbackRate = REPLAY_RATE;
      video.play().catch(() => {});
    });
    cancelScrub = () => {
      stop();
      S.scrubbing = false;
    };
  } else {
    // The closing "Also noted" card: plain playback under it.
    S.dt.replay = null;
    video.playbackRate = 1;
    video.play().catch(() => {});
  }
}

let cardSeq = 0;
/**
 * The double take's card. Stepping: the app's card with back/next and step dots.
 * Live: the same card without the buttons (the clip keeps playing), plus a faint
 * line with the run and time. Either way the reviewer's own pick and note, if any,
 * sit under the app's text.
 */
function showCard(spotRect, text, { i = 0, n = 1, loop = false, live = false, meta = '', mark = null } = {}) {
  leaveCards();
  const el = document.createElement('div');
  el.className = `card${live ? ' live' : ''}`;
  el.dataset.seq = String(++cardSeq);
  el.style.width = `${spotRect.width}px`;
  el.style.left = `${spotRect.cx - spotRect.width / 2}px`;
  el.style[spotRect.side] = `${spotRect.offset}px`;
  el.style.setProperty('--from', spotRect.from === 'below' ? '18px' : '-18px');
  const markHtml = mark ? `<div class="mark">${mark.pick ? '<b>★ Picked</b>' : ''}${mark.note ? `<span>${esc(mark.note)}</span>` : ''}</div>` : '';
  if (live) {
    el.innerHTML = `<p>${esc(text)}</p>${markHtml}<div class="meta">${esc(meta)}</div>`;
  } else {
    const last = i + 1 >= n;
    const dots =
      n <= 12 ? `<span class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</span>` : `<span class="dots">${i + 1}/${n}</span>`;
    el.innerHTML = `<p>${esc(text)}</p>${markHtml}${loop ? '<div class="loop"><i></i></div>' : ''}
    <div class="nav"><button data-card="back" ${i === 0 ? 'disabled' : ''} aria-label="Back">${ICON.back}</button>${dots}
    <button data-card="next" class="${last ? 'fill' : ''}" aria-label="${last ? 'Finish' : 'Next'}">${last ? ICON.done : ICON.next}</button></div>`;
  }
  $('#cards').append(el);
  void el.offsetWidth;
  el.classList.add('in');
}

/** Where a card for `tell` goes, and its text: the same placement the double take uses. */
function placeCard(tell, others, extraH = 0) {
  const { W, H } = stageSize();
  const area = areaOf(tell);
  const padded = area ? holeFor(area, SHAPE, PAD) : null;
  const text = tell.detail ?? tell.label;
  const width = Math.min(320, W - 24);
  const spotRect = cardSpot({
    hole: padded ? grow(padded, padded.feather / 2) : null,
    subject: area,
    placement: tell.placement ?? emptierSide(frameRect(), H, others.map(areaOf).filter(Boolean)),
    stageW: W,
    stageH: H,
    cardH: estimateCardHeight(text, width, false) + extraH,
    safeTop: SAFE_TOP,
    safeBottom: SAFE_BOTTOM,
  });
  return { padded, text, spotRect };
}

/**
 * Live mode: while the clip plays (no double take open), the selected run's
 * annotation for the current moment gets the spotlight and card, and they leave
 * when it's over. One at a time: the one with a box, earliest first.
 */
function updateLive(t) {
  // The double take owns the spotlight and card while it's open.
  if (S.dt.on) return void (S.live = null);
  const want = S.mode === 'live' && !S.dt.on && !!current()?.media && !S.scrubbing;
  const tells = want ? runTells() : [];
  const on = activeTells(tells, t, 0.05).sort((a, b) => (b.box ? 1 : 0) - (a.box ? 1 : 0) || a.t0 - b.t0)[0] ?? null;
  const ref = on ? tellRef(S.runs[S.run].name, on.id) : null;
  if (ref === S.live) return;
  S.live = ref;
  if (!on) {
    spot.onTarget = 0;
    leaveCards();
    return;
  }
  const mark = markOf(S.runs[S.run].name, on);
  // The live card adds a run/time line, and a line for the reviewer's mark.
  const { padded, text, spotRect } = placeCard(on, tells, 18 + (mark ? 24 : 0));
  spot.target = padded;
  spot.onTarget = padded ? 1 : 0;
  if (padded && !spot.cur) spot.cur = { ...padded };
  const run = runLabel(S.runs[S.run].name).name;
  showCard(spotRect, text, { live: true, meta: `${run} · ${clock(on.t0)}–${clock(on.t1)}`, mark });
}

/** Refresh what shows the current clip's marks: lanes, the open card, the drawer and the grid. */
function refreshMarks() {
  renderLanes();
  renderDrawer();
  if (gridOpen) updateGridMarks();
  if (S.dt.on && S.dt.step >= 0) {
    const tell = S.dt.steps[S.dt.step];
    const el = document.querySelector('#cards .card.in .mark');
    const mark = tell && markOf(S.runs[S.run].name, tell);
    const html = mark ? `${mark.pick ? '<b>★ Picked</b>' : ''}${mark.note ? `<span>${esc(mark.note)}</span>` : ''}` : '';
    if (el) el.innerHTML = html;
    else if (html) document.querySelector('#cards .card.in p')?.insertAdjacentHTML('afterend', `<div class="mark">${html}</div>`);
  } else S.live = undefined; // re-show the live card with the new mark
}

/** The annotation on screen: the double take's step, or the live one. */
function tellOnScreen() {
  if (S.dt.on) return S.dt.steps[S.dt.step] ? { run: S.runs[S.run].name, tell: S.dt.steps[S.dt.step] } : null;
  if (!S.live) return null;
  const tell = runTells().find((x) => tellRef(S.runs[S.run].name, x.id) === S.live);
  return tell ? { run: S.runs[S.run].name, tell } : null;
}

async function markTell(run, tell, patch, what) {
  if (!S.key) return;
  if (await send(S.key, { set: { tells: { [tellRef(run, tell.id)]: patch } } }, what)) refreshMarks();
}
function togglePick(run, tell) {
  const on = !markOf(run, tell)?.pick;
  markTell(run, tell, { pick: on }, on ? 'pick' : 'unpick').then(() => toast(on ? '★ Picked' : 'Pick removed'));
}

function leaveCards() {
  for (const el of document.querySelectorAll('#cards .card:not(.out)')) {
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }
}
$('#cards').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-card]');
  if (!b) return;
  e.stopPropagation();
  goStep(S.dt.step + (b.dataset.card === 'next' ? 1 : -1));
});

function markLane() {
  const t = video.currentTime;
  for (const el of laneEls) {
    const lane = +el.dataset.lane;
    const tell = runTells(lane)[+el.dataset.tell];
    const now = S.dt.on ? lane === S.run && tell === S.dt.steps[S.dt.step] : tell && t >= tell.t0 && t <= tell.t1;
    el.classList.toggle('now', !!now);
  }
}

// ---------------------------------------------------------------- play / pause
const pp = $('#pp');
const playBtn = $('#play');
let shownPaused = null;
let flashTimer;
/** The stage's play/pause disc stays while paused (not while the reviewer scrubs) and flashes on a toggle. */
function updatePlayState() {
  const paused = !!current()?.media && video.paused && !S.scrubbing;
  if (paused === shownPaused) return;
  shownPaused = paused;
  playBtn.innerHTML = paused ? ICON.play : ICON.pause;
  playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  if (!pp.classList.contains('flash')) pp.innerHTML = ICON.play;
  pp.classList.toggle('show', paused);
}
function togglePlay() {
  if (!current()?.media) return;
  const play = video.paused;
  if (play) video.play().catch(() => {});
  else video.pause();
  // Flash the new state's glyph; when paused it settles on the play glyph.
  pp.innerHTML = play ? ICON.play : ICON.pause;
  pp.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    pp.classList.remove('flash');
    pp.innerHTML = ICON.play;
  }, 420);
}
playBtn.onclick = togglePlay;

// ---------------------------------------------------------------- per-frame updates
let last = performance.now();
function tick(now) {
  const dt = Math.min(64, now - last);
  last = now;
  const d = duration();
  const t = video.currentTime;

  // Slow-mo replay loop: restart at the window's start (the one allowed jump).
  const rep = S.dt.on ? S.dt.replay : null;
  if (rep && !video.paused && t >= rep.to - 0.02) safeSeek(video, rep.from);

  // Playhead and progress.
  const tw = $('#track').clientWidth;
  const f = d ? Math.max(0, Math.min(1, t / d)) : 0;
  $('#head').style.transform = `translateX(${(f * tw).toFixed(1)}px)`;
  $('#played').style.transform = `scaleX(${f.toFixed(4)})`;
  $('#clock').textContent = `${clock(t)} / ${clock(d)}`;
  markLane();

  // Spotlight: ease the hole toward its target, and fade it in and out.
  const k = 1 - Math.exp(-dt / 90);
  if (spot.target && spot.cur) for (const p of ['x', 'y', 'w', 'h']) spot.cur[p] += (spot.target[p] - spot.cur[p]) * k;
  spot.on += (spot.onTarget - spot.on) * (1 - Math.exp(-dt / 110));
  if (spot.on < 0.002 && spot.onTarget === 0) {
    spot.on = 0;
    if (!S.dt.on) spot.cur = null;
  }
  if (spot.cur) {
    const r = maskPlacement(spot.cur);
    const pos = `${r.x.toFixed(1)}px ${r.y.toFixed(1)}px, 0 0`;
    const size = `${r.w.toFixed(1)}px ${r.h.toFixed(1)}px, 100% 100%`;
    spotEl.style.maskPosition = pos;
    spotEl.style.setProperty('-webkit-mask-position', pos);
    spotEl.style.maskSize = size;
    spotEl.style.setProperty('-webkit-mask-size', size);
  }
  spotEl.style.opacity = (DIM * Math.min(1, spot.on * 1.3)).toFixed(3);

  updateLive(t);
  updatePlayState();

  // The card's loop line.
  const fill = document.querySelector('#cards .card.in .loop i');
  if (fill && rep) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (t - rep.from) / (rep.to - rep.from))).toFixed(3)})`;

  // Outlines show while their tell applies.
  for (const o of outlineEls) o.el.classList.toggle('live', boxShownAt(o.tell, t));

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

video.addEventListener('loadedmetadata', () => {
  renderLanes();
  renderOutlines();
});
new ResizeObserver(() => {
  renderOutlines();
  if (S.dt.on && S.dt.step >= 0) {
    // Re-place the hole and card for the new size, without replaying the scrub.
    const tell = S.dt.steps[S.dt.step];
    const area = areaOf(tell);
    spot.target = area ? holeFor(area, SHAPE, PAD) : null;
  }
}).observe(stage);

// ---------------------------------------------------------------- decisions
function stateOf(key) {
  return S.states[key];
}
/** What the note box was filled with: only your own note (another reviewer's shows in the drawer). */
let noteBase = '';
function renderDecision() {
  const st = stateOf(S.key);
  const d = decided(st);
  $('#keep').classList.toggle('on', d === 'keep');
  $('#drop').classList.toggle('on', d === 'discard');
  const note = $('#note');
  if (document.activeElement !== note) note.value = noteBase = st?.by === S.by ? st.note || '' : '';
}
/** The note box's text when it differs from what it was filled with, else undefined. */
function changedNote() {
  const v = $('#note').value.trim();
  return v !== noteBase ? v : undefined;
}

async function send(key, body, what) {
  const it = S.byKey.get(key);
  try {
    const r = await api('/api/events', { key, by: S.by, url: it?.url, ...body });
    if (r.state) S.states[key] = r.state;
    else delete S.states[key];
    if (body.set) S.undo.push({ id: r.event.id, key, what });
    if (key === S.key) {
      renderDecision();
      renderDrawer();
    }
    return true;
  } catch (e) {
    toast(`Not saved: ${e.message}`);
    return false;
  }
}

async function decide(status) {
  const key = S.key;
  if (!key) return;
  const prev = decided(stateOf(key));
  const next = prev === status ? null : status;
  const set = { status: next };
  const note = changedNote();
  if (note !== undefined) set.note = note;
  if (!(await send(key, { set }, next ? (next === 'keep' ? 'keep' : 'drop') : 'clear'))) return;
  toast(next ? `${next === 'keep' ? 'Kept' : 'Dropped'} · U to undo` : 'Cleared');
  if (next && S.key === key) {
    const at = S.queue.indexOf(key);
    if (at >= 0 && at < S.queue.length - 1) {
      S.i = nextIndex(at, S.queue.length);
      openClip(S.queue[S.i]);
    }
  }
}

function saveNote() {
  const key = S.key;
  if (!key) return;
  const v = changedNote();
  if (v === undefined) return;
  noteBase = v;
  send(key, { set: { note: v } }, 'note').then((ok) => ok && toast('Note saved'));
}

async function undo() {
  const u = S.undo.pop();
  if (!u) return toast('Nothing to undo');
  try {
    const r = await api('/api/events', { key: u.key, by: S.by, undo: u.id });
    if (r.state) S.states[u.key] = r.state;
    else delete S.states[u.key];
    toast(`Undid ${u.what}`);
    if (u.key !== S.key) {
      const at = S.queue.indexOf(u.key);
      if (at >= 0) S.i = at;
      openClip(u.key);
    } else {
      renderDecision();
      refreshMarks();
    }
  } catch (e) {
    toast(`Undo failed: ${e.message}`);
  }
}

$('#keep').onclick = () => decide('keep');
$('#drop').onclick = () => decide('discard');
$('#note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    e.target.blur();
  }
});
$('#note').addEventListener('blur', saveNote);

// ---------------------------------------------------------------- evidence drawer
function consensusHtml(it) {
  const c = it.consensus;
  const t = it.thread || {};
  const pct = Math.round((c.confidence || 0) * 100);
  const name = c.verdict === 'ai' ? 'AI' : c.verdict === 'real' ? 'Real' : 'Unsure';
  const share = c.ai + c.real ? Math.round((100 * c.ai) / (c.ai + c.real)) : 50;
  return `<section><h3>Consensus ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">r/${esc(t.sub || '')} ↗</a>` : ''}</h3>
    <p><b>${name}</b> · ${pct}% · ${c.voters} vote${c.voters === 1 ? '' : 's'}${c.flair ? ` · “${esc(c.flair)}”` : ''}</p>
    <div class="meter" title="AI ${c.ai} vs real ${c.real}"><i style="width:${share}%"></i></div>
    <div class="sub">AI ${c.ai} · real ${c.real}${t.score != null ? ` · +${t.score}, ${t.comments ?? 0} comments` : ''}</div>
    ${(c.evidence || [])
      .slice(0, 6)
      .map((e) => `<div class="quote" style="margin-top:10px">${esc(e.text)}<div class="sub">${e.mod ? 'mod · ' : ''}${esc(e.stance || '')} · +${e.score}${e.permalink ? ` · <a href="${esc(e.permalink)}" target="_blank" rel="noopener">↗</a>` : ''}</div></div>`)
      .join('')}
    ${c.tells?.length ? `<div class="sub" style="margin-top:8px">Cited: ${c.tells.map((x) => `${esc(x.tell)} ×${x.count}`).join(', ')}</div>` : ''}</section>`;
}

/** The reviewer's picks and notes on this clip's annotations, each one a link to that tell. */
function marksHtml(st) {
  const entries = Object.entries(st?.tells ?? {});
  if (!entries.length) return '';
  const rows = entries.map(([ref, m]) => {
    const run = ref.slice(0, ref.indexOf('/'));
    const ri = S.runs.findIndex((r) => r.name === run);
    const tell = S.runs[ri]?.file?.tells.find((t) => tellRef(run, t.id) === ref);
    const label = tell ? `${esc(runLabel(run).name)} · ${esc(tell.label)}` : `${esc(ref)} <span class="sub">(not in this clip's runs)</span>`;
    return `<p>${m.pick ? '★ ' : ''}${tell ? `<a href="#" data-tell-ri="${ri}" data-tell-id="${esc(tell.id)}">${label}</a>` : label}${m.note ? `<br><span class="sub">${esc(m.note)}</span>` : ''}</p>`;
  });
  return `<section><h3>Your marks <a href="#" data-open-grid>All tells</a></h3>${rows.join('')}</section>`;
}

function renderDrawer() {
  const it = current();
  const dr = $('#drawer');
  if (!it) return void (dr.innerHTML = '');
  const st = stateOf(it.key);
  const m = it.media;
  const meta = [it.platform, m ? clock(m.duration).replace(/\.\d$/, '') : 'not built', it.date ? new Date(it.date).toISOString().slice(0, 10) : '', it.views ? `${fmtNum(it.views)} views` : '']
    .filter(Boolean)
    .join(' · ');
  const label = [it.label, it.tier].filter(Boolean).join(' · ');
  const sources = it.in.map((x) => `<span class="chip">${esc(sourceId(x).replace(/^(feed|batch):/, ''))}</span>`).join('');
  const noteText = it.note?.text;
  const partners = [it.pairOf, ...(it.partners || [])].filter((k) => k && S.byKey.has(k));
  const runs = S.runs
    .map((r, i) => {
      const l = runLabel(r.name, r.file?.provenance?.models);
      const when = r.file?.provenance?.generatedAt?.slice(0, 10) ?? '';
      return `<div class="run"><b>${i === S.run ? '● ' : ''}${esc(l.name)}</b><span>${esc(l.model ?? '')}${when ? ` · ${when}` : ''} · ${r.file ? `${r.file.tells.length} tells${r.file.unplaced?.length ? `, ${r.file.unplaced.length} unplaced` : ''}` : 'missing'}</span></div>`;
    })
    .join('');
  const unplaced = S.runs[S.run]?.file?.unplaced ?? [];
  dr.innerHTML = `
    <section><p class="who">@${esc(it.author || it.platform || '?')}</p>
      <div class="meta">${esc(meta)}${label ? `<br>${esc(label)}` : ''}</div>
      <div style="margin-top:8px">${sources}${S.vetted.has(it.key) ? '<span class="chip">worker-vetted</span>' : ''}</div>
      ${it.url ? `<div class="sub"><a href="${esc(it.url)}" target="_blank" rel="noopener">Source ↗</a> · <span>${esc(it.key)}</span></div>` : ''}</section>
    ${st ? `<section><h3>Decision</h3><p>${esc(decided(st) === 'discard' ? 'Dropped' : decided(st) === 'keep' ? 'Kept' : st.status || 'Open')} · ${esc(st.by)} · ${esc(st.at.slice(0, 16).replace('T', ' '))}</p>${st.note ? `<div class="quote">${esc(st.note)}</div>` : ''}</section>` : ''}
    ${noteText ? `<section><h3>Community Note ${it.note.url ? `<a href="${esc(it.note.url)}" target="_blank" rel="noopener">↗</a>` : ''}</h3><div class="quote">${esc(noteText)}</div></section>` : ''}
    ${it.consensus ? consensusHtml(it) : ''}
    ${it.evidence && it.evidence !== noteText && !it.consensus ? `<section><h3>Evidence</h3><div class="quote">${esc(it.evidence)}</div></section>` : ''}
    ${runs ? `<section><h3>Annotation runs</h3><div class="runs">${runs}</div>${unplaced.length ? `<div class="sub" style="margin-top:10px">Not placed: ${unplaced.map((u) => `“${esc(u.quote)}”`).join(' ')}</div>` : ''}</section>` : ''}
    ${marksHtml(st)}
    ${partners.length ? `<section><h3>Compare with</h3>${partners.map((k) => `<p><a href="#${esc(k)}" data-goto="${esc(k)}">${esc(S.byKey.get(k).author ? `@${S.byKey.get(k).author}` : k)}</a> <span class="sub">${esc([S.byKey.get(k).label, S.byKey.get(k).tier].filter(Boolean).join(' · '))}</span></p>`).join('')}</section>` : ''}`;
}
$('#drawer').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-grid]')) {
    e.preventDefault();
    return toggleGrid(true);
  }
  const t = e.target.closest('a[data-tell-ri]');
  if (t) {
    e.preventDefault();
    const ri = +t.dataset.tellRi;
    selectRun(ri, { keepPlace: false });
    const steps = walkthroughSteps(runTells());
    return startDoubleTake(Math.max(0, steps.findIndex((x) => x.id === t.dataset.tellId)));
  }
  const a = e.target.closest('a[data-goto]');
  if (!a) return;
  e.preventDefault();
  const at = S.queue.indexOf(a.dataset.goto);
  if (at >= 0) S.i = at;
  openClip(a.dataset.goto);
});
function toggleDrawer(on = !$('#drawer').classList.contains('open')) {
  $('#drawer').classList.toggle('open', on);
  $('#info-btn').classList.toggle('on', on);
  if (window.matchMedia('(max-width: 760px)').matches) $('#scrim').classList.toggle('on', on);
}

// ---------------------------------------------------------------- queue sheet
function renderQueueSheet() {
  const f = S.filter;
  const seg = (name, opts) =>
    `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${f[name] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const src = sourceOptions(S.items.filter((it) => f.unbuilt || it.media), S.sourceOrder);
  const total = S.items.filter((it) => f.unbuilt || it.media).length;
  $('#queue-sheet').innerHTML = `<h2>Queue</h2>
    ${seg('status', [['unreviewed', 'Unreviewed'], ['keep', 'Kept'], ['discard', 'Dropped'], ['all', 'All']])}
    <h4>Worker</h4>${seg('vetted', [['any', 'Any'], ['vetted', 'Vetted'], ['unvetted', 'Not vetted']])}
    <h4>Annotations</h4>${seg('tells', [['any', 'Any'], ['with', 'With tells'], ['without', 'None']])}
    <h4>Source</h4><div class="sources">
      <button data-src="all" class="${f.source === 'all' ? 'on' : ''}"><span>All</span><span>${total}</span></button>
      ${src.map((s) => `<button data-src="${esc(s.id)}" class="${f.source === s.id ? 'on' : ''}"><span>${esc(s.label)}</span><span>${s.count}</span></button>`).join('')}
    </div>
    <label class="check"><input type="checkbox" id="unbuilt" ${f.unbuilt ? 'checked' : ''}> Include clips that aren't built yet</label>
    <div class="sub" style="margin-top:12px;color:var(--dt-text-dim);font-size:12px">${S.feeds.map((x) => `${esc(x.source)}/${esc(x.name)} ${x.ok ? x.count : '✕'}`).join(' · ')}</div>`;
}
function setFilter(patch) {
  S.filter = { ...S.filter, ...patch };
  store.set('filter', S.filter);
  rebuildQueue(S.key);
  renderQueueSheet();
  if (S.queue[S.i] !== S.key) openClip(S.queue[S.i]);
}
$('#queue-sheet').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const seg = b.closest('[data-seg]');
  if (seg) setFilter({ [seg.dataset.seg]: b.dataset.v });
  else if (b.dataset.src) setFilter({ source: b.dataset.src });
});
$('#queue-sheet').addEventListener('change', (e) => {
  if (e.target.id === 'unbuilt') setFilter({ unbuilt: e.target.checked });
});

let openSheet = null;
function toggleSheet(id) {
  const next = openSheet === id ? null : id;
  for (const s of document.querySelectorAll('.sheet')) s.classList.toggle('open', s.id === next);
  $('#scrim').classList.toggle('on', !!next);
  openSheet = next;
  if (next === 'queue-sheet') renderQueueSheet();
}
$('#queue-btn').onclick = () => toggleSheet('queue-sheet');
$('#help-btn').onclick = () => toggleSheet('help-sheet');
$('#info-btn').onclick = () => toggleDrawer();
$('#prev').onclick = () => go(-1);
$('#next').onclick = () => go(1);
$('#scrim').onclick = () => {
  if (openSheet) toggleSheet(openSheet);
  else toggleDrawer(false);
};

// ---------------------------------------------------------------- live / step
function setMode(m, quiet = false) {
  S.mode = m;
  store.set('mode', m);
  S.live = undefined;
  document.querySelectorAll('#mode button').forEach((b) => {
    const on = b.dataset.mode === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  if (!quiet) toast(m === 'live' ? 'Annotations appear as the clip plays' : 'Annotations only when you step through them');
}
$('#mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b && b.dataset.mode !== S.mode) setMode(b.dataset.mode);
});
setMode(S.mode, true);

// ---------------------------------------------------------------- all tells: every run's annotations in one grid
let gridOpen = false;
let gridCellsNow = [];
let thumbJob = 0;
/** Frames drawn for thumbnails, by clip and time, so reopening the grid is instant. */
const thumbCache = new Map();

function toggleGrid(on = !gridOpen) {
  gridOpen = on;
  $('#gridview').classList.toggle('open', on);
  $('#grid-btn').classList.toggle('on', on);
  if (on) renderGrid();
  else thumbJob++;
}
$('#grid-btn').onclick = () => toggleGrid();
$('#grid-chip').onclick = () => toggleGrid(true);
$('#gv-close').onclick = () => toggleGrid(false);
$('#gv-sort').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sort]');
  if (!b) return;
  S.gridSort = b.dataset.sort;
  store.set('gridSort', S.gridSort);
  renderGrid();
});

function gridCells() {
  const cells = [];
  S.runs.forEach((r, ri) => (r.file?.tells ?? []).forEach((tell) => cells.push({ ri, run: r.name, tell, at: seekTimeFor(tell) })));
  return S.gridSort === 'run' ? cells.sort((a, b) => a.ri - b.ri || a.at - b.at) : cells.sort((a, b) => a.at - b.at || a.ri - b.ri);
}

function renderGrid() {
  const it = current();
  const cells = (gridCellsNow = gridCells());
  document.querySelectorAll('#gv-sort button').forEach((b) => b.classList.toggle('on', b.dataset.sort === S.gridSort));
  const picks = Object.values(S.states[S.key]?.tells ?? {}).filter((m) => m.pick).length;
  $('#gv-title').innerHTML = `All tells <span>· ${cells.length} from ${S.runs.length} run${S.runs.length === 1 ? '' : 's'}${picks ? ` · ${picks} picked` : ''}</span>`;
  const box = $('#gv-cells');
  if (!it?.media || !cells.length) {
    box.innerHTML = `<div class="gv-empty">${it?.media ? 'No annotations for this clip.' : 'No video for this clip.'}</div>`;
    return;
  }
  let lastRun = -1;
  box.innerHTML = cells
    .map((c, i) => {
      const mark = markOf(c.run, c.tell);
      const head = S.gridSort === 'run' && c.ri !== lastRun ? `<div class="gv-group">${esc(runLabel(c.run).name)}</div>` : '';
      lastRun = c.ri;
      return `${head}<div class="cell${mark?.pick ? ' picked' : ''}" data-i="${i}">
        <div class="thumb" data-jump><canvas></canvas><span class="tag">${esc(runLabel(c.run).name)} · ${clock(c.at)}</span></div>
        <div class="body"><div class="lbl" data-jump>${esc(c.tell.label)}</div>${c.tell.detail ? `<div class="det">${esc(c.tell.detail)}</div>` : ''}
          <div class="row"><button class="star${mark?.pick ? ' on' : ''}" data-star title="Pick as a good tell" aria-label="Pick" aria-pressed="${!!mark?.pick}">${ICON.star}</button>
          <input data-note placeholder="Note on this tell" value="${esc(mark?.note ?? '')}" /></div></div></div>`;
    })
    .join('');
  drawThumbs(cells, it);
}

function updateGridMarks() {
  document.querySelectorAll('#gv-cells .cell').forEach((el) => {
    const c = gridCellsNow[+el.dataset.i];
    const mark = c && markOf(c.run, c.tell);
    el.classList.toggle('picked', !!mark?.pick);
    const star = el.querySelector('[data-star]');
    star.classList.toggle('on', !!mark?.pick);
    star.setAttribute('aria-pressed', String(!!mark?.pick));
    const input = el.querySelector('[data-note]');
    if (document.activeElement !== input) input.value = mark?.note ?? '';
  });
  const picks = Object.values(S.states[S.key]?.tells ?? {}).filter((m) => m.pick).length;
  const t = $('#gv-title span');
  if (t) t.textContent = `· ${gridCellsNow.length} from ${S.runs.length} run${S.runs.length === 1 ? '' : 's'}${picks ? ` · ${picks} picked` : ''}`;
}

const once = (el, ev, ms = 8000) =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    el.addEventListener(ev, done);
  });

/** Draw each cell's frame (at the tell's focus time) and its box, from a hidden second video so the player isn't disturbed. */
async function drawThumbs(cells, it) {
  const job = ++thumbJob;
  const aspect = aspectOf(it);
  const W = 360;
  const H = Math.round(W / aspect);
  let v = null;
  for (let i = 0; i < cells.length; i++) {
    if (job !== thumbJob) break;
    const c = cells[i];
    const cacheKey = `${it.key}@${c.at.toFixed(2)}`;
    let frame = thumbCache.get(cacheKey);
    if (!frame) {
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.src = it.media.video;
        await once(v, 'loadeddata');
      }
      v.currentTime = Math.min(c.at, Math.max(0, (v.duration || c.at) - 0.05));
      await once(v, 'seeked');
      if (job !== thumbJob) break;
      frame = document.createElement('canvas');
      frame.width = W;
      frame.height = H;
      try {
        frame.getContext('2d').drawImage(v, 0, 0, W, H);
      } catch {
        // not decodable yet: leave the cell dark
      }
      thumbCache.set(cacheKey, frame);
    }
    const canvas = document.querySelector(`#gv-cells .cell[data-i="${i}"] canvas`);
    if (!canvas) continue;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(frame, 0, 0);
    const b = c.tell.box;
    if (b) {
      // Dim around the box, then outline it: the spotlight, as a still.
      const r = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.roundRect(r.x, r.y, r.w, r.h, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 6);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(245,245,247,0.95)';
      ctx.stroke();
      ctx.restore();
    }
    canvas.classList.add('ready');
  }
  if (v) {
    v.removeAttribute('src');
    v.load();
  }
}

$('#gv-cells').addEventListener('click', (e) => {
  const el = e.target.closest('.cell');
  const c = el && gridCellsNow[+el.dataset.i];
  if (!c) return;
  if (e.target.closest('[data-star]')) return togglePick(c.run, c.tell);
  if (!e.target.closest('[data-jump]')) return;
  // Jump the player there: that run, that tell, in the double take.
  toggleGrid(false);
  selectRun(c.ri, { keepPlace: false });
  startDoubleTake(Math.max(0, walkthroughSteps(runTells()).indexOf(c.tell)));
});
$('#gv-cells').addEventListener('keydown', (e) => {
  if (e.target.matches('[data-note]') && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    e.target.blur();
  }
});
$('#gv-cells').addEventListener('focusout', (e) => {
  if (!e.target.matches('[data-note]')) return;
  const c = gridCellsNow[+e.target.closest('.cell').dataset.i];
  const v = e.target.value.trim();
  if (c && v !== (markOf(c.run, c.tell)?.note ?? '')) markTell(c.run, c.tell, { note: v }, 'tell note').then(() => toast('Note saved'));
});

// ---------------------------------------------------------------- stage gestures: tap, double tap, swipe
let press = null;
let tapTimer = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.card')) return;
  press = { x: e.clientX, y: e.clientY, t: performance.now() };
});
stage.addEventListener('pointerup', (e) => {
  if (!press) return;
  const dx = e.clientX - press.x;
  const dy = e.clientY - press.y;
  press = null;
  if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) return go(dy < 0 ? 1 : -1);
  if (Math.hypot(dx, dy) > 10) return;
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = null;
    return S.dt.on ? exitDoubleTake() : startDoubleTake(0);
  }
  tapTimer = setTimeout(() => {
    tapTimer = null;
    if (S.dt.on) goStep(S.dt.step + 1);
    else togglePlay();
  }, 240);
});

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'checkbox') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const run = (fn) => {
    e.preventDefault();
    fn();
  };
  if (k === 'Escape') {
    if (openSheet) return run(() => toggleSheet(openSheet));
    if (gridOpen) return run(() => toggleGrid(false));
    if ($('#drawer').classList.contains('open')) return run(() => toggleDrawer(false));
    if (S.dt.on) return run(() => exitDoubleTake());
    return;
  }
  if (openSheet && k !== '?' && k !== 'f') return;
  if (gridOpen && !['g', 'j', 'k', 'ArrowDown', 'ArrowUp', 'u', 'a', 'x', 'e', '?'].includes(k)) return;
  if (k === 'j' || k === 'ArrowDown') run(() => go(1));
  else if (k === 'k' || k === 'ArrowUp') run(() => go(-1));
  else if (k === 'ArrowRight' || k === 'ArrowLeft') {
    run(() => {
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (S.dt.on) return goStep(S.dt.step + dir);
      const steps = walkthroughSteps(runTells());
      if (!steps.length) return toast('No annotations in this run');
      // From the current frame; past the last one (or before the first), wrap around.
      const tell = stepFrom(steps, video.currentTime, dir) ?? (dir > 0 ? steps[0] : steps[steps.length - 1]);
      startDoubleTake(steps.indexOf(tell));
    });
  } else if (k === ' ')
    run(() => {
      if (S.dt.on) goStep(S.dt.step + 1);
      else togglePlay();
    });
  else if (k === 'd' || k === 'Enter') run(() => (S.dt.on ? exitDoubleTake() : startDoubleTake(0)));
  else if (/^[1-9]$/.test(k)) run(() => selectRun(+k - 1));
  else if (k === 'v') run(() => S.runs.length && selectRun((S.run + 1) % S.runs.length));
  else if (k === 'b')
    run(() => {
      S.outlines = !S.outlines;
      store.set('outlines', S.outlines);
      renderOutlines();
      toast(S.outlines ? 'Outlines on' : 'Outlines off');
    });
  else if (k === 'l') run(() => setMode(S.mode === 'live' ? 'step' : 'live'));
  else if (k === 'g') run(() => toggleGrid());
  else if (k === 'p')
    run(() => {
      const on = tellOnScreen();
      if (on) togglePick(on.run, on.tell);
      else toast('No annotation on screen to pick');
    });
  else if (k === 'a') run(() => decide('keep'));
  else if (k === 'x') run(() => decide('discard'));
  else if (k === 'n') run(() => $('#note').focus());
  else if (k === 'u') run(undo);
  else if (k === 'e') run(() => toggleDrawer());
  else if (k === 'f') run(() => toggleSheet('queue-sheet'));
  else if (k === '?') run(() => toggleSheet('help-sheet'));
  else if (k === 'm')
    run(() => {
      S.muted = !S.muted;
      video.muted = S.muted;
      toast(S.muted ? 'Muted' : 'Sound on');
    });
});

// ---------------------------------------------------------------- start
(async () => {
  try {
    await load();
  } catch (e) {
    $('#empty').hidden = false;
    $('#empty').textContent = `Couldn't load: ${e.message}`;
    return;
  }
  const want = decodeURIComponent(location.hash.slice(1));
  rebuildQueue(want);
  openClip(want && S.byKey.has(want) ? want : S.queue[S.i]);
})();
