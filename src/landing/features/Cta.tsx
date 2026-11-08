import { useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { readTellsFile } from '@/annotations/format';
import { seekTimeFor, walkthroughSteps } from '@/annotations/walkthrough';
import { GalleryClips, Tile, useAtlasBoards, useTilePlayback, type GalleryClip } from '../Tile';
import type { FeatureValues } from './designs';
import { paint, px } from './engine';
import { SKILLS } from './mock';
import { clamp01, easeInOut, easeOut, lerp, seg, wheels } from './timeline';

export type CtaDesign = FeatureValues['cta'];

interface Props {
  design: CtaDesign;
  /** The hero's button words. */
  button: string;
  /** The hero's launch from this element: a tile grows into the feed; anything else goes back to the hero first. */
  launchFrom(el: HTMLElement | null): void;
  rootRef: RefObject<HTMLElement | null>;
}

/**
 * The last call to open the app, in one of several designs. Every one ends
 * in the hero's own launch: the ones with clips launch from a clip, which
 * grows into the feed where it is (the page doesn't scroll back up).
 */
export function FinalCta(p: Props) {
  switch (p.design) {
    case 'quiz':
      return <QuizCta {...p} />;
    case 'phone':
      return <PhoneCta {...p} />;
    case 'score':
      return <ScoreCta {...p} />;
    case 'wall':
      return <WallCta {...p} />;
    default:
      return (
        <section className="lt-section lt-final" data-exit="">
          <h2 className="lt-h2">Ready for a double take?</h2>
          <button type="button" className="lt-cta" onClick={(e) => p.launchFrom(e.currentTarget)}>
            <span>{p.button}</span>
            <ArrowRight size={20} />
          </button>
        </section>
      );
  }
}

// ---- shared ----------------------------------------------------------------

/** Clips for a challenge: gallery clips (already loading for the hero) whose answer the feed knows, mixed. */
function useChallenge(n: number) {
  const gallery = useContext(GalleryClips);
  const [clips, setClips] = useState<readonly Clip[]>([]);
  useEffect(() => {
    let live = true;
    void loadInitialClips().then((c) => live && setClips(c));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const known = gallery.filter((g) => clips[g.index]?.verdict);
    const ai = known.filter((g) => clips[g.index].verdict === 'ai');
    const real = known.filter((g) => clips[g.index].verdict === 'real');
    // Skip the hero's first few (they're the ones on screen at the top).
    const pick: GalleryClip[] = [];
    const order = [ai[3], real[1], ai[5], real[2], ai[7], ...known.slice(8)];
    for (const g of order) if (g && !pick.includes(g) && pick.length < n) pick.push(g);
    return pick.map((g) => ({ gallery: g, clip: clips[g.index] }));
  }, [gallery, clips, n]);
}

/** A tell to show with an answer: the clip's first placed tell (fetched only once answered), else its evidence. */
function useWhy(clip: Clip | undefined, on: boolean): string | null {
  const fallback = clip?.verdictEvidence ?? (clip?.verdict === 'real' ? 'Filmed, not generated.' : null);
  const fetches = on && !!clip && clip.verdict === 'ai' && !!clip.tellsUrl;
  const [tell, setTell] = useState<string | null>(null);
  useEffect(() => {
    if (!fetches || !clip?.tellsUrl) return;
    let live = true;
    void fetch(clip.tellsUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const t = d ? walkthroughSteps(readTellsFile(d).tells)[0] : undefined;
        const s = t ? Math.floor(seekTimeFor(t)) : 0;
        if (live && t) setTell(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${t.label}`);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clip, fetches]);
  return on ? (tell ?? fallback) : null;
}

/**
 * Calls `fn` with how far `ref` has come into view (0 as its top enters the
 * bottom of the screen, 1 once its top has risen `span` screens), every frame
 * the page scrolls while it's in view. One listener, transforms only.
 */
function useScrollIn(rootRef: RefObject<HTMLElement | null>, ref: RefObject<HTMLElement | null>, span: number, fn: (q: number) => void) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    const root = rootRef.current;
    const el = ref.current;
    if (!root || !el) return;
    let raf = 0;
    let visible = false;
    const frame = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const h = root.clientHeight;
      latest.current(clamp01((h - r.top) / (h * span)));
    };
    const schedule = () => {
      if (visible && !raf) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        schedule();
      },
      { root },
    );
    io.observe(el);
    root.addEventListener('scroll', schedule, { passive: true });
    return () => {
      io.disconnect();
      root.removeEventListener('scroll', schedule);
      cancelAnimationFrame(raf);
    };
  }, [rootRef, ref, span]);
}

function Mark({ right }: { right: boolean }) {
  return <span className="ftc-mark">{right ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}</span>;
}

// ---- (a) a three-clip challenge --------------------------------------------

/** Real or AI? on three clips, right here: each answer comes back with what gave it away. */
function QuizCta({ launchFrom }: Props) {
  const ref = useRef<HTMLElement>(null);
  const items = useChallenge(3);
  const [calls, setCalls] = useState<('ai' | 'real' | undefined)[]>([]);
  const key = items.map((i) => i.gallery.index).join(',');
  useTilePlayback(ref, key);
  useAtlasBoards(ref, key);
  const done = items.length > 0 && items.every((_, i) => calls[i]);
  const right = items.filter((it, i) => calls[i] === it.clip.verdict).length;
  const last = useRef<HTMLElement | null>(null);
  return (
    <section className="lt-section lt-final ftc ftc-quiz" data-exit="" ref={ref}>
      <h2 className="lt-h2">Real or AI?</h2>
      <p className="lt-lede">Three clips. Make your call on each.</p>
      <div className="ftc-row">
        {items.map((it, i) => (
          <QuizCard
            key={it.gallery.index}
            n={it.gallery.index}
            clip={it.clip}
            call={calls[i]}
            onCall={(c, tile) => {
              last.current = tile;
              setCalls((old) => Object.assign([...old], { [i]: c }));
            }}
          />
        ))}
      </div>
      <p className="ftc-tally" data-on={done ? '' : undefined}>
        You got {right} of {items.length}.
      </p>
      <button type="button" className="lt-cta" onClick={(e) => launchFrom(last.current ?? e.currentTarget)}>
        <span>Keep playing in the app</span>
        <ArrowRight size={20} />
      </button>
    </section>
  );
}

function QuizCard({ n, clip, call, onCall }: { n: number; clip: Clip; call?: 'ai' | 'real'; onCall(c: 'ai' | 'real', tile: HTMLElement | null): void }) {
  const tile = useRef<HTMLDivElement>(null);
  const why = useWhy(clip, !!call);
  const right = call === clip.verdict;
  const answer = (c: 'ai' | 'real') => {
    if (!call) onCall(c, tile.current?.querySelector<HTMLElement>('[data-tile]') ?? null);
  };
  return (
    <div className="ftc-card" data-called={call ? '' : undefined}>
      <div className="ftc-tile" ref={tile}>
        <Tile clip={n} />
        <div className="ftc-answer" data-right={right ? '' : undefined}>
          <Mark right={right} />
          <b>{clip.verdict === 'ai' ? 'AI' : 'Real'}</b>
          <small>{why ?? ' '}</small>
        </div>
      </div>
      <div className="ftc-calls">
        {(['real', 'ai'] as const).map((c) => (
          <button key={c} type="button" aria-pressed={call === c} disabled={!!call && call !== c} onClick={() => answer(c)}>
            {c === 'ai' ? 'AI' : 'Real'}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- (b) the phone becomes the app -----------------------------------------

/** A phone comes forward as the page scrolls to it; its button grows its clip into the feed. */
function PhoneCta({ rootRef, launchFrom }: Props) {
  const ref = useRef<HTMLElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLHeadingElement>(null);
  const items = useChallenge(1);
  const n = items[0]?.gallery.index ?? 4;
  useTilePlayback(ref, String(n));
  useAtlasBoards(ref, String(n));
  useScrollIn(rootRef, ref, 1.1, (q) => {
    const t = easeOut(q);
    paint(phone.current, `translate3d(0, ${px((1 - t) * 160)}, ${px(lerp(-260, 0, t))}) rotateX(${lerp(26, 0, t).toFixed(2)}deg)`, seg(q, 0, 0.35));
    paint(words.current, `translate3d(0, ${px((1 - t) * 60)}, 0) scale(${lerp(0.9, 1, t).toFixed(4)})`, seg(q, 0.2, 0.7));
  });
  const go = () => launchFrom(phone.current?.querySelector<HTMLElement>('[data-tile]') ?? null);
  return (
    <section className="lt-final ftc ftc-phone" data-exit="" ref={ref}>
      <h2 className="ftc-huge" ref={words}>
        Start scrolling.
      </h2>
      <div className="ftc-stage">
        <div className="ftc-phone-body" ref={phone} onClick={go}>
          <Tile clip={n} hero />
          <i className="ftc-island" />
        </div>
      </div>
      <button type="button" className="lt-cta" onClick={go}>
        <span>Start scrolling</span>
        <ArrowRight size={20} />
      </button>
    </section>
  );
}

// ---- (c) a score to beat ----------------------------------------------------

/** "You spotted 0 of 3. Can you beat 68?": tap the clips you think are AI, the count rolls up. */
function ScoreCta({ launchFrom }: Props) {
  const ref = useRef<HTMLElement>(null);
  const items = useChallenge(3);
  const [marked, setMarked] = useState<boolean[]>([]);
  const key = items.map((i) => i.gallery.index).join(',');
  useTilePlayback(ref, key);
  useAtlasBoards(ref, key);
  const spotted = items.filter((it, i) => marked[i] && it.clip.verdict === 'ai').length;
  const aiCount = items.filter((it) => it.clip.verdict === 'ai').length;
  const digits = useRef<HTMLElement>(null);
  // The count rolls to its new value (an odometer wheel), eased, from wherever it is.
  const shown = useRef(0);
  useEffect(() => {
    let raf = 0;
    const from = shown.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = easeInOut(Math.min(1, (now - start) / 420));
      shown.current = lerp(from, spotted, t);
      paint(digits.current, `translate3d(0, ${(-wheels(shown.current).ones).toFixed(3)}em, 0)`);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spotted]);
  const lastTile = useRef<HTMLElement | null>(null);
  return (
    <section className="lt-section lt-final ftc ftc-score" data-exit="" ref={ref}>
      <h2 className="lt-h2">
        You spotted{' '}
        <span className="ftc-odo">
          <i ref={digits}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => (
              <b key={i}>{d}</b>
            ))}
          </i>
        </span>{' '}
        of {aiCount || 3}.
      </h2>
      <p className="lt-lede">Tap the ones you think are AI. Most people who play land around {SKILLS.general.score}. Can you beat it?</p>
      <div className="ftc-row">
        {items.map((it, i) => (
          <div
            role="button"
            tabIndex={0}
            aria-pressed={!!marked[i]}
            key={it.gallery.index}
            className="ftc-tile ftc-markable"
            data-marked={marked[i] ? '' : undefined}
            data-right={(marked[i] ? it.clip.verdict === 'ai' : it.clip.verdict === 'real') ? '' : undefined}
            onClick={(e) => {
              lastTile.current = e.currentTarget.querySelector<HTMLElement>('[data-tile]');
              setMarked((m) => Object.assign([...m], { [i]: !m[i] }));
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.currentTarget.click();
            }}
          >
            <Tile clip={it.gallery.index} />
            <span className="ftc-stamp">AI</span>
            <span className="ftc-verdict">
              <Mark right={it.clip.verdict === 'ai'} />
              {it.clip.verdict === 'ai' ? 'It is AI' : 'It is real'}
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="lt-cta" onClick={(e) => launchFrom(lastTile.current ?? e.currentTarget)}>
        <span>Beat {SKILLS.general.score} in the app</span>
        <ArrowRight size={20} />
      </button>
    </section>
  );
}

// ---- (d) the wall comes back -------------------------------------------------

const WALL_COLS = 6;
const WALL_ROWS = 3;
/** Where each tile starts, scattered, before the wall assembles (fixed, so it looks the same each visit). */
const SCATTER = Array.from({ length: WALL_COLS * WALL_ROWS }, (_, i) => {
  const a = (i * 2.399963) % (Math.PI * 2);
  const r = 0.7 + ((i * 37) % 11) / 11;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: -300 - ((i * 53) % 7) * 80, rot: ((i * 29) % 21) - 10 };
});

/** The hero's wall of clips reassembles around the button as the page arrives; the button pulls the nearest one in. */
function WallCta({ rootRef, launchFrom, button }: Props) {
  const ref = useRef<HTMLElement>(null);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const pull = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const key = 'wall';
  useTilePlayback(ref, key);
  useAtlasBoards(ref, key);
  useScrollIn(rootRef, ref, 1, (q) => {
    tiles.current.forEach((el, i) => {
      const s = SCATTER[i];
      // Each settles a little after the last, from the outside in.
      const t = easeInOut(seg(q, 0.15 + (i % 5) * 0.04, 0.75 + (i % 5) * 0.04));
      paint(
        el,
        `translate3d(${(s.x * (1 - t) * 60).toFixed(2)}vw, ${(s.y * (1 - t) * 50).toFixed(2)}vh, ${px(s.z * (1 - t))}) rotate(${(s.rot * (1 - t)).toFixed(2)}deg)`,
        seg(q, 0.05, 0.4),
      );
    });
    paint(words.current, `translate3d(0, ${px((1 - easeOut(seg(q, 0.45, 0.9))) * 30)}, 0)`, seg(q, 0.45, 0.85));
  });
  // The button draws the wall toward it while the pointer is near (a CSS transition: it retargets smoothly).
  const near = (on: boolean) => pull.current?.toggleAttribute('data-pull', on);
  const go = (e: React.MouseEvent<HTMLElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const t of ref.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? []) {
      const r = t.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestD) [best, bestD] = [t, d];
    }
    launchFrom(best ?? e.currentTarget);
  };
  return (
    <section className="lt-final ftc ftc-wall" data-exit="" ref={ref}>
      <div className="ftc-wall-pull" ref={pull}>
        <div className="ftc-wall-grid">
          {SCATTER.map((_, i) => {
            const centre = i % WALL_COLS >= 2 && i % WALL_COLS <= 3 && Math.floor(i / WALL_COLS) === 1;
            return (
              <div
                key={i}
                className="ftc-wall-cell"
                data-centre={centre ? '' : undefined}
                style={{ opacity: 0 }}
                ref={(el) => {
                  tiles.current[i] = el;
                }}
              >
                {!centre && <Tile clip={11 + i * 2} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ftc-wall-words" ref={words} style={{ opacity: 0 }}>
        <h2 className="lt-h2">Ready for a double take?</h2>
        <button type="button" className="lt-cta" onClick={go} onPointerEnter={() => near(true)} onPointerLeave={() => near(false)} onFocus={() => near(true)} onBlur={() => near(false)}>
          <span>{button}</span>
          <ArrowRight size={20} />
        </button>
      </div>
    </section>
  );
}
