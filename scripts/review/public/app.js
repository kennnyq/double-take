/* Clip review UI (dev only). Served by scripts/review/server.ts; no build step. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
  const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const fmtNum = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`review.${k}`);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`review.${k}`, JSON.stringify(v));
      } catch {
        // private mode: fine
      }
    },
  };
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- state ----------
  const S = {
    items: [],
    byKey: new Map(),
    feeds: [],
    batches: [],
    states: {},
    tags: [],
    dups: new Map(), // key -> Set of keys
    view: [], // [{title, keys}]
    order: [], // unique keys in display order
    cur: 0,
    focusOpen: false,
    showBoxes: store.get('boxes', true),
    muted: store.get('muted', true),
    autoAdvance: store.get('autoAdvance', true),
    by: store.get('by', 'kenny'),
    tellsModel: store.get('tellsModel', 'main'),
    undo: [], // [{id, key, what}]
    q: '',
    group: 'in',
    sort: 'feed',
    filters: {}, // facet -> Set(values)
  };

  const labelClass = (it) => (it.kind === 'unknown' ? '' : it.kind);
  const KIND = { ai: 'AI', real: 'Real', cgi: 'CGI / animation', unknown: 'Other label' };
  const labelTier = (it) => (it.tier ? `${it.label || '?'} · ${it.tier}` : it.label || '(no label)');
  const statusOf = (key) => S.states[key]?.status || 'unreviewed';
  const tagsOf = (key) => S.states[key]?.tags || [];
  const pairId = (it) => it.pairOf || (it.partners.length ? it.key : null);
  /** The clips shown side by side with `it`: its AI clip first, then that clip's real partners. */
  function pairGroup(it) {
    const ai = it.pairOf ? S.byKey.get(it.pairOf) : it.partners.length ? it : null;
    if (!ai) return [it];
    const g = [ai, ...ai.partners.map((k) => S.byKey.get(k)).filter(Boolean)];
    return g.includes(it) ? g : [...g, it];
  }
  const feedId = (f) => `${f.source}/${f.name}`;
  const memberName = (m) => (m.kind === 'feed' ? `feed ${feedId(m)}` : `batch ${m.name}`);
  const tellsBucket = (it) => (!it.media ? 'not built' : it.media.tells.length ? 'has tells' : 'no tells');
  const STATUS_ORDER = ['unreviewed', 'needs-work', 'keep', 'discard'];

  // Facets: id, title, values(it) -> string[]
  const FACETS = [
    { id: 'status', title: 'Status', values: (it) => [statusOf(it.key)], order: STATUS_ORDER },
    { id: 'kind', title: 'AI / real', values: (it) => [KIND[it.kind]], order: Object.values(KIND) },
    { id: 'in', title: 'Feed / batch', values: (it) => it.in.map(memberName) },
    { id: 'label', title: 'Label / tier', values: (it) => [labelTier(it)] },
    {
      id: 'consensus',
      title: 'Consensus',
      values: (it) =>
        it.consensus ? [`${it.consensus.verdict} ${it.consensus.confidence >= 0.9 ? '≥90%' : it.consensus.confidence >= 0.75 ? '75–90%' : '<75%'}`] : ['no thread'],
    },
    { id: 'tells', title: 'Tells', values: (it) => [tellsBucket(it)], order: ['has tells', 'no tells', 'not built'] },
    { id: 'platform', title: 'Source', values: (it) => [it.platform || '?'] },
    { id: 'tag', title: 'Tags', values: (it) => (tagsOf(it.key).length ? tagsOf(it.key) : ['(no tags)']) },
    { id: 'pair', title: 'Pairs', values: (it) => [pairId(it) ? 'in a pair' : 'no pair'] },
    { id: 'dup', title: 'Duplicate hints', values: (it) => [S.dups.has(it.key) ? 'possible duplicate' : 'no hint'] },
    { id: 'notes', title: 'Feedback', values: (it) => [S.states[it.key]?.note ? 'has note' : 'no note'] },
  ];
  const facet = (id) => FACETS.find((f) => f.id === id);

  // ---------- URL state ----------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    S.q = p.get('q') || '';
    S.group = p.get('g') || store.get('group', 'in');
    S.sort = p.get('s') || store.get('sort', 'feed');
    S.filters = {};
    for (const f of (p.get('f') || '').split('|').filter(Boolean)) {
      const i = f.indexOf(':');
      const id = f.slice(0, i);
      (S.filters[id] ||= new Set()).add(decodeURIComponent(f.slice(i + 1)));
    }
    return p.get('open');
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    p.set('g', S.group);
    p.set('s', S.sort);
    const f = [];
    for (const [id, vals] of Object.entries(S.filters)) for (const v of vals) f.push(`${id}:${encodeURIComponent(v)}`);
    if (f.length) p.set('f', f.join('|'));
    if (S.focusOpen && S.order[S.cur]) p.set('open', S.order[S.cur]);
    history.replaceState(null, '', `#${p}`);
    store.set('group', S.group);
    store.set('sort', S.sort);
  }

  // ---------- filtering / grouping ----------
  function matches(it, skipFacet) {
    for (const [id, vals] of Object.entries(S.filters)) {
      if (id === skipFacet || !vals.size) continue;
      const f = facet(id);
      if (f && !f.values(it).some((v) => vals.has(v))) return false;
    }
    if (S.q) {
      const st = S.states[it.key];
      const hay = [it.key, it.url, it.author, it.title, it.evidence, it.note?.text, it.thread?.title, ...(it.consensus?.evidence || []).map((e) => e.text), it.label, it.tier, st?.note, ...(st?.tags || [])]
        .join(' ')
        .toLowerCase();
      for (const w of S.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!hay.includes(w)) return false;
    }
    return true;
  }
  function feedRank(it) {
    const feedNames = S.feeds.map(feedId);
    const batchNames = S.batches.map((b) => b.name);
    let best = Infinity;
    for (const m of it.in) {
      const g = m.kind === 'feed' ? feedNames.indexOf(feedId(m)) : feedNames.length + batchNames.indexOf(m.name);
      best = Math.min(best, g * 1e5 + m.index);
    }
    return best;
  }
  function sorter() {
    const by = {
      feed: (a, b) => feedRank(a) - feedRank(b),
      newest: (a, b) => (b.date || 0) - (a.date || 0),
      oldest: (a, b) => (a.date || Infinity) - (b.date || Infinity),
      short: (a, b) => (a.media?.duration || Infinity) - (b.media?.duration || Infinity),
      long: (a, b) => (b.media?.duration || 0) - (a.media?.duration || 0),
      reviewed: (a, b) => (S.states[b.key]?.at || '').localeCompare(S.states[a.key]?.at || ''),
    }[S.sort];
    return (a, b) => by(a, b) || feedRank(a) - feedRank(b);
  }
  function groupsFor(items) {
    if (S.group === 'none') return [{ title: 'All clips', items }];
    const map = new Map();
    const add = (k, it) => (map.get(k) || map.set(k, []).get(k)).push(it);
    for (const it of items) {
      if (S.group === 'pair') {
        const ai = S.byKey.get(pairId(it));
        add(pairId(it) ? `pair: ${ai?.author ? `@${ai.author} · ` : ''}${pairId(it)}` : 'no pair', it);
      }
      else if (S.group === 'dup') {
        const d = S.dups.get(it.key);
        add(d ? `duplicates: ${[it.key, ...d].sort()[0]}` : 'no duplicate hint', it);
      } else if (S.group === 'author') add(it.author || '(unknown author)', it);
      else for (const v of facet(S.group).values(it)) add(v, it);
    }
    const order = facet(S.group)?.order;
    const last = (t) => /^(no |\(no)/.test(t);
    return [...map.entries()]
      .sort(([a, ai], [b, bi]) => {
        if (order) return order.indexOf(a) - order.indexOf(b);
        if (last(a) !== last(b)) return last(a) ? 1 : -1;
        if (S.group === 'in') return feedRank(ai[0]) - feedRank(bi[0]);
        return bi.length - ai.length || a.localeCompare(b);
      })
      .map(([title, its]) => {
        // Pair groups lead with the AI clip.
        if (S.group === 'pair') its.sort((x, y) => (x.pairOf ? 1 : 0) - (y.pairOf ? 1 : 0));
        return { title, items: its };
      });
  }

  /** Recompute the visible list. Decisions don't call this, so a decided clip stays put. */
  function applyView(keepKey) {
    const key = keepKey ?? S.order[S.cur];
    const items = S.items.filter((it) => matches(it)).sort(sorter());
    S.view = groupsFor(items).map((g) => ({ title: g.title, keys: g.items.map((i) => i.key) }));
    const seen = new Set();
    S.order = [];
    for (const g of S.view) for (const k of g.keys) if (!seen.has(k)) seen.add(k) && S.order.push(k);
    const i = S.order.indexOf(key);
    S.cur = i >= 0 ? i : 0;
    renderFacets();
    renderGrid();
    renderProgress();
    writeHash();
  }

  // ---------- rendering ----------
  /** A subreddit thread's verdict: who said what, weighted by votes, and the tells they cite. */
  function consensusHtml(it) {
    const c = it.consensus;
    const t = it.thread || {};
    const pct = Math.round((c.confidence || 0) * 100);
    const name = c.verdict === 'ai' ? 'AI' : c.verdict === 'real' ? 'Real' : 'Unsure';
    const share = c.ai + c.real ? Math.round((100 * c.ai) / (c.ai + c.real)) : 50;
    return `<div><h4>Consensus ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">↗ r/${esc(t.sub || '')}</a>` : ''}</h4>
      <div class="consensus ${esc(c.verdict)}"><b>${name}</b> · ${pct}% confident · ${c.voters} vote${c.voters === 1 ? '' : 's'}${c.flair ? ` · flair “${esc(c.flair)}”` : ''}
        <div class="bar" title="AI weight ${c.ai} vs real ${c.real}"><span style="width:${share}%"></span></div>
        <div class="hist">AI ${c.ai} · real ${c.real}${t.score != null ? ` · thread +${t.score}, ${t.comments ?? 0} comments` : ''}</div></div>
      ${(c.evidence || [])
        .map((e) => `<div class="quote">${esc(e.text)}<div class="hist">${e.mod ? 'mod · ' : ''}${esc(e.stance || '')} · +${e.score}${e.permalink ? ` · <a href="${esc(e.permalink)}" target="_blank" rel="noopener">comment ↗</a>` : ''}</div></div>`)
        .join('')}
      ${c.tells?.length ? `<div class="hist">Tells cited: ${c.tells.map((x) => `${esc(x.tell)} ×${x.count}`).join(', ')}</div>` : ''}</div>`;
  }

  function renderProgress() {
    const count = (keys) => {
      const c = { keep: 0, discard: 0, 'needs-work': 0 };
      for (const k of keys) if (S.states[k]?.status) c[S.states[k].status]++;
      return c;
    };
    const all = S.items.map((i) => i.key);
    const a = count(all);
    const v = count(S.order);
    const done = a.keep + a.discard + a['needs-work'];
    const vdone = v.keep + v.discard + v['needs-work'];
    const pct = (n) => `${(100 * n) / Math.max(1, all.length)}%`;
    $('#progress').innerHTML = `
      <div><b>${done}</b>/${all.length} reviewed · ${a.keep} keep · ${a.discard} discard · ${a['needs-work']} needs work
        <span title="In the current view">· view ${vdone}/${S.order.length}</span></div>
      <div class="bar"><i class="k" style="width:${pct(a.keep)}"></i><i class="w" style="width:${pct(a['needs-work'])}"></i><i class="d" style="width:${pct(a.discard)}"></i></div>`;
  }

  function renderFacets() {
    const feedLine = S.feeds
      .map((f) => (f.ok ? `${esc(feedId(f))} ${f.count}` : `<span class="bad" title="${esc(f.error)}">${esc(feedId(f))} ✕</span>`))
      .join(' · ');
    let html = `<p class="feedstat">Feeds: ${feedLine || 'none'}</p>`;
    for (const f of FACETS) {
      const counts = new Map();
      for (const it of S.items) if (matches(it, f.id)) for (const v of new Set(f.values(it))) counts.set(v, (counts.get(v) || 0) + 1);
      for (const v of S.filters[f.id] || []) if (!counts.has(v)) counts.set(v, 0);
      if (f.id === 'tag') for (const t of S.tags) if (!counts.has(t)) counts.set(t, 0);
      const vals = [...counts.entries()].sort(([a, x], [b, y]) =>
        f.order ? f.order.indexOf(a) - f.order.indexOf(b) : y - x || a.localeCompare(b),
      );
      const on = S.filters[f.id] || new Set();
      html += `<div class="facet"><h3>${esc(f.title)}${on.size ? `<button data-clear="${f.id}">clear</button>` : ''}</h3>`;
      for (const [v, n] of vals)
        html += `<button class="chip ${on.has(v) ? 'on' : ''}" data-facet="${f.id}" data-v="${esc(v)}"><span class="name">${esc(v)}</span><span class="n">${n}</span></button>`;
      html += '</div>';
    }
    $('#facets').innerHTML = html;
  }

  function tileHtml(it) {
    const st = statusOf(it.key);
    const tags = tagsOf(it.key);
    const lc = labelClass(it);
    const thumb = it.media
      ? `<img loading="lazy" src="${esc(it.media.poster)}" alt="">`
      : `<div class="nomedia"><b>Not built yet</b><span>${esc((it.evidence || it.url || '').slice(0, 160))}</span></div>`;
    const badges = [
      `<span class="b ${lc}">${esc(labelTier(it))}</span>`,
      it.media?.tells.length ? `<span class="b" title="Tells: ${esc(it.media.tells.map((t) => t.name).join(', '))}">tells</span>` : '',
      pairId(it) ? `<span class="b" title="Pair">⇄</span>` : '',
      S.dups.has(it.key) ? `<span class="b warn" title="Possible duplicate of ${esc([...S.dups.get(it.key)].join(', '))}">dup?</span>` : '',
      it.labels.length > 1 ? `<span class="b warn" title="Sources disagree: ${esc(it.labels.join(', '))}">label?</span>` : '',
      st !== 'unreviewed' ? `<span class="b r ${st}">${st}</span>` : '',
    ].join('');
    return `<div class="tile s-${st}" data-key="${esc(it.key)}">
      <div class="thumb">${thumb}<div class="badges">${badges}</div>${it.media ? `<span class="b dur">${fmtDur(it.media.duration)}</span>` : ''}</div>
      <div class="meta">
        <div class="row"><span class="who">@${esc(it.author || it.platform || '?')}</span></div>
        <div class="row">${tags.map((t) => `<span class="b tag">${esc(t)}</span>`).join('') || `<span class="who">${esc(it.key)}</span>`}${S.states[it.key]?.note ? '<span title="Has a note">✎</span>' : ''}</div>
      </div></div>`;
  }

  function renderGrid() {
    const grid = $('#grid');
    if (!S.order.length) {
      grid.innerHTML = `<div class="empty">No clips match. ${Object.keys(S.filters).length || S.q ? 'Clear some filters.' : ''}</div>`;
      return;
    }
    grid.innerHTML = S.view
      .map((g) => {
        const done = g.keys.filter((k) => S.states[k]?.status).length;
        return `<section class="group"><h2>${esc(g.title)} <span class="n">${done}/${g.keys.length} reviewed</span></h2>
          <div class="tiles">${g.keys.map((k) => tileHtml(S.byKey.get(k))).join('')}</div></section>`;
      })
      .join('');
    markCursor(false);
  }

  /** Re-render one clip's tiles in place (after a decision) without moving the list. */
  function patchTile(key) {
    const it = S.byKey.get(key);
    for (const el of document.querySelectorAll(`.tile[data-key="${CSS.escape(key)}"]`)) {
      const tmp = document.createElement('div');
      tmp.innerHTML = tileHtml(it);
      el.replaceWith(tmp.firstElementChild);
    }
    markCursor(false);
    renderProgress();
  }

  function markCursor(scroll = true) {
    const key = S.order[S.cur];
    for (const el of document.querySelectorAll('.tile.cur')) el.classList.remove('cur');
    const els = document.querySelectorAll(`.tile[data-key="${CSS.escape(key || '')}"]`);
    els.forEach((el) => el.classList.add('cur'));
    if (scroll && els[0]) els[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Hover-play tiles (desktop pointers only).
  let hoverVid;
  function stopHover() {
    hoverVid?.remove();
    hoverVid = null;
  }
  $('#grid').addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const tile = e.target.closest('.tile');
    if (!tile || tile.contains(hoverVid)) return;
    stopHover();
    const it = S.byKey.get(tile.dataset.key);
    if (!it?.media) return;
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, src: it.media.tile || it.media.video });
    tile.querySelector('.thumb').prepend(v);
    v.addEventListener('playing', () => tile.querySelector('.thumb img')?.style.setProperty('visibility', 'hidden'));
    hoverVid = v;
  });
  $('#grid').addEventListener('pointerout', (e) => {
    const tile = e.target.closest('.tile');
    if (tile && !tile.contains(e.relatedTarget)) {
      tile.querySelector('.thumb img')?.style.removeProperty('visibility');
      if (tile.contains(hoverVid)) stopHover();
    }
  });
  $('#grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    S.cur = S.order.indexOf(tile.dataset.key);
    markCursor(false);
    openFocus();
  });
  $('#facets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.clear) delete S.filters[b.dataset.clear];
    else {
      const set = (S.filters[b.dataset.facet] ||= new Set());
      set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
      if (!set.size) delete S.filters[b.dataset.facet];
    }
    applyView();
  });

  // ---------- focus view ----------
  const tellsCache = new Map();
  async function loadTells(url) {
    if (!tellsCache.has(url)) tellsCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return tellsCache.get(url);
  }
  let focusTells = []; // tells of the main clip for the chosen model

  function playerHtml(it, role) {
    if (!it) return '';
    const cap = `<div class="cap"><span class="b ${labelClass(it)}">${esc(labelTier(it))}</span>
      <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.key)}</a>
      ${role === 'partner' ? `<a href="#" data-goto="${esc(it.key)}">review this one</a>` : ''}
      ${S.states[it.key]?.status ? `<span class="b ${S.states[it.key].status}">${S.states[it.key].status}</span>` : ''}</div>`;
    if (!it.media)
      return `<div class="player">${cap}<div class="vbox"><div class="nomedia">Not built into a feed yet, so there's no media here.
        <br><br><a href="${esc(it.url)}" target="_blank" rel="noopener">Open the source ↗</a></div></div></div>`;
    return `<div class="player" data-role="${role}">${cap}
      <div class="vbox"><video playsinline loop preload="auto" poster="${esc(it.media.poster)}" src="${esc(it.media.video)}"></video>
      ${role === 'main' ? '<div class="boxes"></div>' : ''}</div>
      <div class="scrub" data-role="${role}"><div class="pos"></div></div></div>`;
  }

  function sideHtml(it) {
    const st = S.states[it.key];
    const status = st?.status;
    const m = it.media;
    const dups = S.dups.get(it.key);
    const pair = pairGroup(it).filter((x) => x !== it);
    const models = m?.tells.map((t) => t.name) || [];
    const kv = (k, v) => (v || v === 0 ? `<dt>${k}</dt><dd>${v}</dd>` : '');
    return `
      <div class="decide-dock"><div class="decide">
        <button class="keep ${status === 'keep' ? 'on' : ''}" data-status="keep">1 · Keep</button>
        <button class="discard ${status === 'discard' ? 'on' : ''}" data-status="discard">2 · Discard</button>
        <button class="needs-work ${status === 'needs-work' ? 'on' : ''}" data-status="needs-work">3 · Needs work</button>
      </div></div>
      <div><h4>Tags <kbd>T</kbd></h4><div class="taglist">${S.tags
        .map((t) => `<button data-tag="${esc(t)}" class="${st?.tags?.includes(t) ? 'on' : ''}">${esc(t)}</button>`)
        .join('')}${(st?.tags || [])
        .filter((t) => !S.tags.includes(t))
        .map((t) => `<button data-tag="${esc(t)}" class="on">${esc(t)}</button>`)
        .join('')}</div></div>
      <div><h4>Feedback <kbd>N</kbd></h4><textarea id="note" placeholder="What's wrong or right with this clip?">${esc(st?.note || '')}</textarea>
        <div class="hist">${st ? `Last change by ${esc(st.by)} · ${esc(st.at.slice(0, 16).replace('T', ' '))} · ${st.events} change${st.events === 1 ? '' : 's'}` : 'Not reviewed yet'}</div></div>
      <div><h4>Clip</h4><dl class="kv">
        ${kv('Label', esc(it.labels.join(' / ') || '—'))}${kv('Tier', esc(it.tier))}
        ${kv('In', esc(it.in.map(memberName).join(', ')))}
        ${kv('Author', esc(it.author))}${kv('Posted', fmtDate(it.date))}
        ${kv('Duration', m ? `${m.duration}s · ${m.width}×${m.height}` : 'not built')}
        ${kv('Views', fmtNum(it.views))}${kv('Likes', fmtNum(it.likes))}
        ${kv('Section', esc(it.section))}
        ${kv('Source', it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a>` : '')}
        ${kv('Pair', pair.map((x) => `<a href="#" data-goto="${esc(x.key)}">${esc(x.key)}</a> (${esc(labelTier(x))})`).join('<br>'))}
        ${kv('Found via', esc(it.how))}
        ${kv('Duplicates?', dups ? [...dups].map((k) => `<a href="#" data-goto="${esc(k)}">${esc(k)}</a>`).join(', ') : '')}
        ${kv('Title', esc(it.title))}
      </dl></div>
      ${it.consensus ? consensusHtml(it) : it.evidence ? `<div><h4>Evidence</h4><div class="quote">${esc(it.evidence)}</div></div>` : ''}
      ${
        it.note?.text && it.note.text !== it.evidence
          ? `<div><h4>Community Note ${it.note.url ? `<a href="${esc(it.note.url)}" target="_blank" rel="noopener">↗</a>` : ''} ${esc(it.note.status || '')}</h4><div class="quote">${esc(it.note.text)}</div></div>`
          : it.note?.url
            ? `<div><h4>Community Note <a href="${esc(it.note.url)}" target="_blank" rel="noopener">↗</a> ${esc(it.note.status || '')}</h4></div>`
            : ''
      }
      <div><h4>Tells <kbd>B</kbd> boxes</h4>
        ${models.length ? `<div class="seg">${models.map((n) => `<button data-model="${esc(n)}" class="${n === currentModel(it) ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}
        <div class="tells-list" id="tells-list">${models.length ? 'Loading…' : '<span class="hist">No tells for this clip.</span>'}</div></div>`;
  }

  const currentModel = (it) => {
    const names = it.media?.tells.map((t) => t.name) || [];
    return names.includes(S.tellsModel) ? S.tellsModel : names[0];
  };

  async function renderTells(it) {
    const list = $('#tells-list');
    focusTells = [];
    const t = it.media?.tells.find((x) => x.name === currentModel(it));
    if (!t || !list) return;
    const data = await loadTells(t.url);
    if (S.order[S.cur] !== it.key) return;
    focusTells = (data?.tells || []).filter((x) => typeof x.t0 === 'number');
    const unplaced = data?.unplaced || [];
    list.innerHTML =
      focusTells
        .map(
          (x, i) => `<button class="tell" data-tell="${i}"><b>${esc(x.label)} <span class="d">${x.t0.toFixed(1)}–${(x.t1 ?? x.t0).toFixed(1)}s · ${esc(x.category || '')} · ${esc(x.confidence || '')}</span></b>
          ${x.detail ? `<span class="d">${esc(x.detail)}</span>` : ''}</button>`,
        )
        .join('') +
        unplaced.map((x) => `<div class="tell"><b>Also noted: ${esc(x.label || x.claim || '')}</b><span class="d">${esc(x.detail || '')}</span></div>`).join('') ||
      '<span class="hist">The tells file is empty.</span>';
    drawSpans();
  }

  const mainVideo = () => $('#focus .player[data-role="main"] video');
  const allVideos = () => [...document.querySelectorAll('#focus video')];

  /** Where the video's picture sits inside its object-fit: contain box. */
  function contentRect(v) {
    const W = v.clientWidth;
    const H = v.clientHeight;
    const vw = v.videoWidth || 16;
    const vh = v.videoHeight || 9;
    const s = Math.min(W / vw, H / vh);
    return { left: (W - vw * s) / 2, top: (H - vh * s) / 2, width: vw * s, height: vh * s };
  }
  function drawBoxes() {
    const v = mainVideo();
    const host = $('#focus .boxes');
    if (!v || !host) return;
    const r = contentRect(v);
    Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const t = v.currentTime;
    const live = focusTells.filter((x) => t >= x.t0 - 0.05 && t <= (x.t1 ?? x.t0) + 0.05);
    host.innerHTML = S.showBoxes
      ? live
          .filter((x) => x.box)
          .map(
            (x) =>
              `<div class="tb" style="left:${x.box.x * 100}%;top:${x.box.y * 100}%;width:${x.box.w * 100}%;height:${x.box.h * 100}%"><span>${esc(x.label)}</span></div>`,
          )
          .join('')
      : '';
    document.querySelectorAll('#tells-list .tell[data-tell]').forEach((el) => {
      el.classList.toggle('now', live.includes(focusTells[+el.dataset.tell]));
    });
  }
  function drawSpans() {
    const v = mainVideo();
    const bar = $('#focus .scrub[data-role="main"]');
    if (!v || !bar) return;
    const d = v.duration || S.byKey.get(S.order[S.cur])?.media?.duration || 1;
    bar.querySelectorAll('.span').forEach((e) => e.remove());
    for (const x of focusTells) {
      const s = document.createElement('div');
      s.className = 'span';
      s.style.left = `${(x.t0 / d) * 100}%`;
      s.style.width = `${Math.max(0.6, (((x.t1 ?? x.t0) - x.t0) / d) * 100)}%`;
      bar.prepend(s);
    }
  }
  function tick() {
    if (!S.focusOpen) return;
    for (const v of allVideos()) {
      const bar = v.closest('.player').querySelector('.scrub .pos');
      if (bar && v.duration) bar.style.width = `${(v.currentTime / v.duration) * 100}%`;
    }
    drawBoxes();
    requestAnimationFrame(tick);
  }

  function openFocus() {
    const it = S.byKey.get(S.order[S.cur]);
    if (!it) return;
    stopHover();
    const players = pairGroup(it).slice(0, 4);
    if (!players.includes(it)) players[players.length - 1] = it;
    const f = $('#focus');
    f.innerHTML = `<div class="fbar"><button data-act="close" title="Back to grid (Esc)">✕</button>
        <button data-act="prev" title="Previous (K)">‹</button><button data-act="next" title="Next (J)">›</button>
        <span class="pos">${S.cur + 1} / ${S.order.length}</span>
        <span class="title">@${esc(it.author || it.platform || '?')} — ${esc(it.key)}</span>
        <button data-act="mute" title="Mute (M)">${S.muted ? '🔇' : '🔊'}</button>
        <button data-act="undo" title="Undo (U)">↶</button></div>
      <div class="body"><div class="stage${players.length > 2 ? ' many' : ''}">${players.map((x) => playerHtml(x, x === it ? 'main' : 'partner')).join('')}</div>
        <aside class="side">${sideHtml(it)}</aside></div>`;
    f.hidden = false;
    const wasOpen = S.focusOpen;
    S.focusOpen = true;
    for (const v of allVideos()) {
      v.muted = S.muted;
      v.play().catch(() => {});
    }
    mainVideo()?.addEventListener('loadedmetadata', drawSpans);
    renderTells(it);
    writeHash();
    markCursor();
    if (!wasOpen) requestAnimationFrame(tick);
  }
  function closeFocus() {
    S.focusOpen = false;
    for (const v of allVideos()) v.pause();
    $('#focus').hidden = true;
    $('#focus').innerHTML = '';
    writeHash();
    markCursor();
  }
  function move(d) {
    if (!S.order.length) return;
    saveNoteIfChanged();
    S.cur = Math.max(0, Math.min(S.order.length - 1, S.cur + d));
    if (S.focusOpen) openFocus();
    else markCursor();
  }

  $('#focus').addEventListener('click', (e) => {
    const b = e.target.closest('button, a[data-goto], .scrub');
    if (!b) return;
    const it = S.byKey.get(S.order[S.cur]);
    if (b.classList.contains('scrub')) {
      const v = b.closest('.player').querySelector('video');
      const r = b.getBoundingClientRect();
      if (v?.duration) v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
      return;
    }
    if (b.dataset.goto) {
      e.preventDefault();
      goto(b.dataset.goto);
    } else if (b.dataset.act === 'close') closeFocus();
    else if (b.dataset.act === 'prev') move(-1);
    else if (b.dataset.act === 'next') move(1);
    else if (b.dataset.act === 'mute') toggleMute();
    else if (b.dataset.act === 'undo') undo();
    else if (b.dataset.status) decide(it.key, b.dataset.status);
    else if (b.dataset.tag) toggleTag(it.key, b.dataset.tag);
    else if (b.dataset.model) {
      S.tellsModel = b.dataset.model;
      store.set('tellsModel', S.tellsModel);
      document.querySelectorAll('#focus .seg button').forEach((x) => x.classList.toggle('on', x === b));
      renderTells(it);
    } else if (b.dataset.tell) {
      const x = focusTells[+b.dataset.tell];
      const v = mainVideo();
      if (v && x) {
        v.currentTime = x.focusT ?? x.t0;
        v.pause();
      }
    }
  });
  $('#focus').addEventListener('focusout', (e) => {
    if (e.target.id === 'note') saveNoteIfChanged();
  });

  function goto(key) {
    let i = S.order.indexOf(key);
    if (i < 0) {
      // Not in the current view: show everything so the link works.
      S.filters = {};
      S.q = '';
      $('#search').value = '';
      applyView(key);
      i = S.order.indexOf(key);
    }
    if (i >= 0) {
      saveNoteIfChanged();
      S.cur = i;
      openFocus();
    }
  }

  function toggleMute() {
    S.muted = !S.muted;
    store.set('muted', S.muted);
    for (const v of allVideos()) v.muted = S.muted;
    const b = $('#focus [data-act="mute"]');
    if (b) b.textContent = S.muted ? '🔇' : '🔊';
  }

  // ---------- decisions ----------
  async function send(key, body, what) {
    const it = S.byKey.get(key);
    try {
      const r = await api('/api/events', { method: 'POST', body: { key, by: S.by, url: it?.url, ...body } });
      if (r.state) S.states[key] = r.state;
      else delete S.states[key];
      if (body.set) S.undo.push({ id: r.event.id, key, what });
      patchTile(key);
      if (S.focusOpen && S.order[S.cur] === key) refreshSide(key);
      return true;
    } catch (e) {
      toast(`Not saved: ${e.message}`);
      return false;
    }
  }
  function refreshSide(key) {
    const side = $('#focus .side');
    if (!side) return;
    const ta = $('#note');
    const draft = ta && document.activeElement === ta ? ta.value : null;
    side.innerHTML = sideHtml(S.byKey.get(key));
    if (draft != null) {
      $('#note').value = draft;
      $('#note').focus();
    }
    renderTells(S.byKey.get(key));
  }
  async function decide(key, status) {
    const prev = statusOf(key);
    const next = status === prev ? null : status;
    const ok = await send(key, { set: { status: next } }, next ? `${next}` : `cleared ${prev}`);
    if (!ok) return;
    toast(next ? `${key}: ${next}` : `${key}: cleared`);
    if (next && S.autoAdvance && S.order[S.cur] === key && S.cur < S.order.length - 1) move(1);
  }
  async function toggleTag(key, tag) {
    const cur = tagsOf(key);
    const tags = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
    await send(key, { set: { tags } }, `tag ${tag}`);
  }
  let noteKey = null;
  function saveNoteIfChanged() {
    const ta = $('#note');
    const key = noteKey ?? S.order[S.cur];
    if (!ta || !key) return;
    const v = ta.value.trim();
    if (v !== (S.states[key]?.note || '')) send(key, { set: { note: v } }, 'note').then((ok) => ok && toast('Note saved'));
  }
  async function undo() {
    const last = S.undo.pop();
    if (!last) return toast('Nothing to undo in this session');
    try {
      const r = await api('/api/events', { method: 'POST', body: { key: last.key, by: S.by, undo: last.id } });
      if (r.state) S.states[last.key] = r.state;
      else delete S.states[last.key];
      patchTile(last.key);
      toast(`Undid ${last.what} on ${last.key}`);
      const i = S.order.indexOf(last.key);
      if (i >= 0 && i !== S.cur) {
        S.cur = i;
        if (S.focusOpen) openFocus();
        else markCursor();
      } else if (S.focusOpen) refreshSide(last.key);
    } catch (e) {
      toast(`Undo failed: ${e.message}`);
    }
  }

  // ---------- tag palette ----------
  function openTags() {
    const key = S.order[S.cur];
    if (!key) return;
    const dlg = $('#tags-dlg');
    const render = () => {
      const cur = tagsOf(key);
      dlg.innerHTML = `<h2>Tags · ${esc(key)}</h2><ol>${S.tags
        .map((t, i) => `<li><button data-tag="${esc(t)}" class="${cur.includes(t) ? 'on' : ''}"><kbd>${(i + 1) % 10}</kbd>${esc(t)}</button></li>`)
        .join('')}</ol><p class="hist">Number toggles · Esc or T closes · edit the list in ⚙</p>`;
    };
    render();
    dlg.onclick = async (e) => {
      const b = e.target.closest('button[data-tag]');
      if (b) {
        await toggleTag(key, b.dataset.tag);
        render();
      }
    };
    dlg.onkeydown = async (e) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const t = S.tags[(+e.key + 9) % 10];
        if (t) {
          await toggleTag(key, t);
          render();
        }
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        dlg.close();
      }
    };
    dlg.showModal();
  }

  // ---------- settings ----------
  function openSettings() {
    const dlg = $('#settings-dlg');
    dlg.innerHTML = `<h2>Settings</h2><div class="settings">
      <label>Reviewer name (saved with each decision)<input type="text" id="set-by" value="${esc(S.by)}"></label>
      <label><input type="checkbox" id="set-adv" ${S.autoAdvance ? 'checked' : ''}> Move to the next clip after a decision</label>
      <label>Quick tags, one per line (stored in scripts/harvest/review/tags.json)
        <textarea id="set-tags" rows="9">${esc(S.tags.join('\n'))}</textarea></label>
      <p class="hist">Feeds: ${S.feeds.map((f) => `${esc(feedId(f))} ${f.ok ? `✓ ${f.count}` : `✕ ${esc(f.error)}`}`).join(' · ')}<br>
        Batches: ${S.batches.map((b) => `${esc(b.name)} (${b.count})`).join(', ')}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button id="set-refresh">Refetch feeds</button><button id="set-save">Save</button><button id="set-close">Close</button></div></div>`;
    $('#set-close').onclick = () => dlg.close();
    $('#set-refresh').onclick = async () => {
      dlg.close();
      await load(true);
      toast('Feeds refetched');
    };
    $('#set-save').onclick = async () => {
      S.by = $('#set-by').value.trim() || 'anon';
      store.set('by', S.by);
      S.autoAdvance = $('#set-adv').checked;
      store.set('autoAdvance', S.autoAdvance);
      const tags = $('#set-tags').value.split('\n').map((t) => t.trim()).filter(Boolean);
      try {
        S.tags = (await api('/api/tags', { method: 'PUT', body: { tags } })).tags;
        dlg.close();
        renderFacets();
        if (S.focusOpen) refreshSide(S.order[S.cur]);
        toast('Settings saved');
      } catch (e) {
        toast(`Tags not saved: ${e.message}`);
      }
    };
    dlg.showModal();
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox') || el.tagName === 'SELECT');
    if (document.querySelector('dialog[open]')) return;
    if (typing) {
      if (el.id === 'note' && (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)))) {
        e.preventDefault();
        el.blur();
      } else if (el.id === 'search' && (e.key === 'Escape' || e.key === 'Enter')) {
        el.blur();
        $('#grid').focus();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = S.order[S.cur];
    const v = mainVideo();
    const k = e.key;
    const handled = () => e.preventDefault();
    if (k === 'j' || k === 'J' || k === 'ArrowDown' || k === 'ArrowRight') handled(), move(1);
    else if (k === 'k' || k === 'K' || k === 'ArrowUp' || k === 'ArrowLeft') handled(), move(-1);
    else if ((k === 'Enter' || k === 'o' || k === 'O') && !S.focusOpen) handled(), openFocus();
    else if (k === 'Escape' && S.focusOpen) handled(), closeFocus();
    else if (k === '1' && key) handled(), decide(key, 'keep');
    else if (k === '2' && key) handled(), decide(key, 'discard');
    else if (k === '3' && key) handled(), decide(key, 'needs-work');
    else if (k === '0' && key && S.states[key]?.status) handled(), decide(key, S.states[key].status);
    else if ((k === 't' || k === 'T') && key) handled(), openTags();
    else if ((k === 'n' || k === 'N') && key) {
      handled();
      if (!S.focusOpen) openFocus();
      $('#note')?.focus();
    } else if (k === ' ' && S.focusOpen) {
      handled();
      const vids = allVideos();
      const play = vids.some((x) => x.paused);
      vids.forEach((x) => (play ? x.play().catch(() => {}) : x.pause()));
    } else if (k === ',' && v) handled(), allVideos().forEach((x) => (x.currentTime = Math.max(0, x.currentTime - 1)));
    else if (k === '.' && v) handled(), allVideos().forEach((x) => (x.currentTime += 1));
    else if (k === 'b' || k === 'B') {
      handled();
      S.showBoxes = !S.showBoxes;
      store.set('boxes', S.showBoxes);
      toast(S.showBoxes ? 'Tell boxes on' : 'Tell boxes off');
    } else if (k === 'm' || k === 'M') handled(), toggleMute();
    else if (k === 'u' || k === 'U') handled(), undo();
    else if (k === '/') handled(), $('#search').focus();
    else if (k === 'r' || k === 'R') handled(), applyView(), toast('Filters re-applied');
    else if (k === '?') handled(), $('#help-dlg').showModal();
  });
  // Track which clip the note box belongs to, so a save after moving goes to the right clip.
  document.addEventListener('focusin', (e) => {
    if (e.target.id === 'note') noteKey = S.order[S.cur];
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id === 'note') setTimeout(() => (noteKey = null), 0);
  });

  // ---------- top bar ----------
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.q = e.target.value.trim();
      applyView();
    }, 150);
  });
  $('#group').addEventListener('change', (e) => {
    S.group = e.target.value;
    applyView();
  });
  $('#sort').addEventListener('change', (e) => {
    S.sort = e.target.value;
    applyView();
  });
  $('#help-btn').onclick = () => $('#help-dlg').showModal();
  $('#settings-btn').onclick = openSettings;
  $('#filters-btn').onclick = () => $('#facets').classList.toggle('open');
  window.addEventListener('resize', drawBoxes);

  // ---------- duplicate hints ----------
  function link(a, b) {
    if (a === b) return;
    // Clips in one AI↔real pair share a note by design; that's not a duplicate.
    const pa = S.byKey.get(a);
    const pb = S.byKey.get(b);
    if (pa && pb && (pairId(pa) ?? 1) === (pairId(pb) ?? 2)) return;
    (S.dups.get(a) || S.dups.set(a, new Set()).get(a)).add(b);
    (S.dups.get(b) || S.dups.set(b, new Set()).get(b)).add(a);
  }
  /** Cheap hints first: same file hash, same evidence text. */
  function textDups() {
    const by = (f) => {
      const m = new Map();
      for (const it of S.items) {
        const v = f(it);
        if (v) (m.get(v) || m.set(v, []).get(v)).push(it.key);
      }
      for (const keys of m.values()) for (const k of keys.slice(1)) link(keys[0], k);
    };
    by((it) => it.media?.sha256);
    by((it) => (it.evidence && it.evidence.length > 60 ? it.evidence.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 200) : ''));
  }
  /** Then near-identical posters: a 64-bit difference hash per poster, compared pairwise. */
  async function posterDups() {
    const cache = store.get('dhash', {});
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const hashOf = (it) =>
      new Promise((resolve) => {
        if (cache[it.key]) return resolve(cache[it.key]);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, 9, 8);
            const d = ctx.getImageData(0, 0, 9, 8).data;
            let bits = '';
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++) {
                const p = (y * 9 + x) * 4;
                const l = d[p] + d[p + 1] + d[p + 2];
                const r = d[p + 4] + d[p + 5] + d[p + 6];
                bits += l > r ? '1' : '0';
              }
            cache[it.key] = bits;
            resolve(bits);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = it.media.poster;
      });
    const withMedia = S.items.filter((it) => it.media);
    const hashes = [];
    for (let i = 0; i < withMedia.length; i += 8) {
      const batch = withMedia.slice(i, i + 8);
      const hs = await Promise.all(batch.map(hashOf));
      batch.forEach((it, j) => hs[j] && hashes.push([it.key, hs[j]]));
    }
    store.set('dhash', cache);
    const before = S.dups.size;
    for (let i = 0; i < hashes.length; i++)
      for (let j = i + 1; j < hashes.length; j++) {
        let d = 0;
        const a = hashes[i][1];
        const b = hashes[j][1];
        for (let k = 0; k < 64 && d <= 4; k++) if (a[k] !== b[k]) d++;
        // Flat posters (black frames) hash alike; skip them.
        if (d <= 4 && /0/.test(a) && /1/.test(a)) link(hashes[i][0], hashes[j][0]);
      }
    if (S.dups.size !== before) {
      renderFacets();
      for (const k of S.dups.keys()) patchTile(k);
    }
  }

  // ---------- load ----------
  async function load(refresh = false) {
    const [cat, dec, tags] = await Promise.all([
      api(`/api/catalog${refresh ? '?refresh=1' : ''}`),
      api('/api/decisions'),
      api('/api/tags'),
    ]);
    S.items = cat.items;
    S.byKey = new Map(S.items.map((i) => [i.key, i]));
    S.feeds = cat.feeds;
    S.batches = cat.batches;
    S.states = dec.states;
    S.tags = tags.tags;
    if (dec.skipped) toast(`${dec.skipped} unreadable line(s) in decisions.jsonl were skipped`);
    S.dups = new Map();
    textDups();
    applyView();
    posterDups();
  }

  const openKey = readHash();
  $('#search').value = S.q;
  $('#group').value = S.group;
  $('#sort').value = S.sort;
  load()
    .then(() => {
      if (openKey) goto(openKey);
    })
    .catch((e) => {
      $('#grid').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`;
    });
})();
