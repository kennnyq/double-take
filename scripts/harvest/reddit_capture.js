// Browser capture for pick_reddit.py --capture: read r/isthisAI as a person would, in a
// normal (logged-out) browser tab, and save what the rendered page shows as JSONL.
//
// Reddit closed new Data API access and blocks scripted JSON reads, so the harvest can
// read pages instead. Paste one function into the console of an open Reddit tab (or run
// it through a preview tool's evaluate), then call it:
//
//   captureListing('top:year')   on https://www.reddit.com/r/isthisAI/top/?t=year
//   captureThread()              on one post's comment page
//
// Each saves a .jsonl download. Read-only: it scrolls and reads, nothing else. It waits
// 4 s between scrolls (one feed page each). Progress is in `window.__dt`.

/* eslint-disable no-unused-vars -- console helpers, called by hand */

// One row per listed post: the shreddit-post element's attributes and its flair text.
async function captureListing(listing, { maxScrolls = 16, gapMs = 4000 } = {}) {
  const KEEP = ['id', 'permalink', 'content-href', 'post-type', 'domain', 'score', 'comment-count',
    'created-timestamp', 'post-title', 'author', 'nsfw', 'spoiler'];
  const st = (window.__dt = { running: true, posts: 0, listing });
  const seen = new Map();
  const grab = () => {
    for (const p of document.querySelectorAll('shreddit-post')) {
      const id = p.getAttribute('id');
      if (!id || seen.has(id)) continue;
      const o = { listing };
      for (const k of KEEP) if (p.hasAttribute(k)) o[k] = p.getAttribute(k);
      const f = p.querySelector('shreddit-post-flair, flair-tag');
      o.flair = f ? f.innerText.trim() : null;
      seen.set(id, o);
    }
    st.posts = seen.size;
  };
  let still = 0;
  for (let i = 0; i < maxScrolls && still < 3; i++) {
    const before = seen.size;
    grab();
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, gapMs));
    grab();
    still = seen.size === before ? still + 1 : 0;
  }
  save(`dt-listing-${listing.replace(':', '-')}.jsonl`, [...seen.values()]);
  st.running = false;
  return seen.size;
}

// One row for the open post: its comments as rendered (score, depth, author, text).
function captureThread() {
  const post = document.querySelector('shreddit-post');
  const comments = [...document.querySelectorAll('shreddit-comment')].map((c) => {
    const body = c.querySelector(':scope > [slot="comment"]');
    return {
      id: c.getAttribute('thingid'),
      parent: c.getAttribute('parentid'),
      depth: Number(c.getAttribute('depth') || 0),
      score: Number(c.getAttribute('score') || 0),
      author: c.getAttribute('author'),
      permalink: c.getAttribute('permalink'),
      mod: c.getAttribute('distinguished') === 'moderator' || undefined,
      body: body ? body.innerText.trim().slice(0, 2000) : '',
    };
  });
  const row = { thread: post?.getAttribute('id'), comments };
  save(`dt-thread-${row.thread}.jsonl`, [row]);
  return comments.length;
}

function save(name, rows) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => JSON.stringify(r)).join('\n') + '\n']));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
