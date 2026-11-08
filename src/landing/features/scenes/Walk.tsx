import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Asset } from 'expo-asset';
import { REPLAY_RATE } from '@/annotations/walkthrough';
import { DEFAULT_SETTINGS } from '@/devtools/settings';
import { cardSpot, type CardSpot } from '@/feed/card';
import { SIRI, linesFromTops, revealFrame, revealMetrics, revealPlan, revealWords, type RevealUnit } from '@/feed/reveal';
import { planScrub, runScrub, safeSeek } from '@/feed/scrub';
import { MASK_SIZE, dimBands, holeFor, maskFor, maskPlacement, paddingPx, spotlightStrength, type Hole, type MaskName, type Rect } from '@/feed/spotlight';
import { boxOnScreen, type DemoStep } from '../demo';
import { paint, px, useHost, useScene, type Dims } from '../engine';
import { clamp01, easeInOut, lerp } from '../timeline';
import { checkLook, dotLook, walkFrame } from '../walk';
import { AppTabBar, AppTopBar, AroundScreen, CANVAS_W, Canvas, Clip, FeedChrome, OnScreen, TapHand, tabStrip, paintHand } from './parts';

/** The dimming images the app's spotlight uses: black outside a soft-edged hole. */
const HOLE_IMAGES: Record<MaskName, number> = {
  rect: require('../../../../assets/spotlight/hole-rect.png'),
  rounded: require('../../../../assets/spotlight/hole-rounded.png'),
  ellipse: require('../../../../assets/spotlight/hole-ellipse.png'),
  soft: require('../../../../assets/spotlight/hole-soft.png'),
  blob: require('../../../../assets/spotlight/hole-blob.png'),
};

const S = DEFAULT_SETTINGS;
/** The card's text style (InfoCard's), and its box: text from 13 px, then the footer row and 9 px. */
const TEXT = revealMetrics({ fontSize: 15, lineHeight: 20 });
const TEXT_TOP = 13;
const FOOTER = 40;
const BOTTOM = 9;
/** How far the card travels as it comes in (InfoCard's TRAVEL). */
const TRAVEL = 18;
/** The bottom row's pieces rise the way InfoCard's FooterItem does. */
const FOOTER_METRICS = { lineHeight: 20, descent: 3.6 };

/** When the bottom row starts, on the card's clock: its text's last line plus one line stagger (InfoCard's footerStart). */
function footerStart(total: number): number {
  return Math.max(0, total - SIRI.settle) + SIRI.lineStagger;
}

/** The card's whole entrance on its clock: the text, then the bottom row's three pieces settled (InfoCard's). */
function fullMs(total: number): number {
  return Math.max(total, footerStart(total) + 24 + SIRI.settle);
}

interface Plan {
  units: RevealUnit[];
  total: number;
  /** The text's height, px. */
  height: number;
}

interface StepGeo {
  box: Rect;
  hole: Hole;
  /** The card's top left on the screen, and its glass height. */
  x: number;
  y: number;
  h: number;
  spot: CardSpot;
}

/** The feed's video area on the phone, px: the screen above the app's tab bar. */
export function feedHeight(d: Dims): number {
  return d.sh - tabStrip() * (d.sw / CANVAS_W);
}

function geometry(steps: DemoStep[], aspect: number, d: Dims, cardW: number, plans: Plan[]): StepGeo[] {
  const fh = feedHeight(d);
  return steps.map((st, k) => {
    const box = st.box ? boxOnScreen(st.box, aspect, d.sw, fh) : { x: d.sw * 0.25, y: fh * 0.35, w: d.sw * 0.5, h: fh * 0.2 };
    const hole = holeFor(box, S.spotlightShape, paddingPx(S.spotlightPadding) * (d.sw / CANVAS_W));
    const h = TEXT_TOP + (plans[k]?.height ?? 40) + FOOTER + BOTTOM;
    const spot = cardSpot({ hole, subject: box, placement: 'bottom', stageW: d.sw, stageH: fh, cardH: h, safeTop: 56, safeBottom: 20, maxWidth: cardW });
    const y = spot.side === 'top' ? spot.offset : fh - spot.offset - h;
    return { box, hole, x: spot.cx - spot.width / 2, y, h, spot };
  });
}

/**
 * The card lifted a little off the screen toward `side`: a short sideways
 * offset (past the screen's edge if it's near one), a touch nearer, a soft
 * shadow under it. It stays parallel to the screen.
 */
function liftPlace(g: StepGeo, side: 1 | -1, d: Dims, w: number) {
  const shift = Math.min(w * (d.narrow ? 0.05 : 0.11), d.narrow ? 14 : 34) * Math.min(1, d.pop || 1);
  return { x: g.x + side * shift, y: g.y - (d.narrow ? 4 : 8), z: d.narrow ? 14 : 30, rot: 0, scale: 1.02 };
}

/** Where a card goes out to: beside the phone on `side`, level with its tell (or on the rail's panel). */
function popPlace(g: StepGeo, side: 1 | -1, d: Dims, w: number, scale: number) {
  if (d.narrow || d.pop <= 0) return { x: g.x, y: g.y - 10 * d.pop, z: 60 * d.pop, rot: 0, scale: 1 + 0.12 * d.pop };
  const half = (w * scale) / 2;
  const reach = 30 + 40 * d.pop;
  // Kept on the stage (with room for its turn and its nearness): overlapping the phone's edge if it must.
  const room = (side > 0 ? d.roomR : d.roomL) - 16 - w * 0.08 * d.pop;
  const cx = side > 0 ? Math.max(d.sw * 0.66, Math.min(d.sw + reach + half, d.sw + room - half)) : Math.min(d.sw * 0.34, Math.max(-reach - half, -room + half));
  const cy = d.railY ?? Math.max(g.h / 2 + 8, Math.min(d.sh - g.h / 2 - 8, g.hole.y + g.hole.h / 2));
  // Turned to face the phone a little: its far edge recedes.
  return { x: cx - w / 2, y: cy - g.h / 2, z: 70 * d.pop, rot: side * (6 + 6 * d.pop), scale };
}

/**
 * Scroll and the walkthrough: the feed swipes to a clip, a double tap opens
 * its double take, and each further stretch of scroll is the next step, the
 * card coming out of the screen beside the phone and going back. The pieces
 * are the app's (spotlight, Siri text reveal, step dots turning into a check,
 * eased scrubs between moments), driven by the scroll instead of a clock.
 */
export function WalkScene() {
  const { dims, media, values, invalidate } = useHost();
  const walk = media?.walk;
  const other = media?.others[0];
  const steps = useMemo(() => (walk ? walk.steps.slice(0, Number(values.steps)) : []), [walk, values.steps]);
  const n = steps.length;
  const aspect = walk?.aspect ?? 9 / 16;
  const cardW = dims ? Math.min(320, dims.sw - 24) : 300;
  const holeUri = useMemo(() => Asset.fromModule(HOLE_IMAGES[maskFor(S.spotlightShape)]).uri, []);
  // The app's strongest setting: on a phone this size, the medium one barely reads.
  const { dim } = spotlightStrength(3);

  const layer = useRef<HTMLDivElement>(null);
  const clipA = useRef<HTMLDivElement>(null);
  const clipB = useRef<HTMLDivElement>(null);
  const chromeA = useRef<HTMLDivElement>(null);
  const chromeB = useRef<HTMLDivElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const holeEl = useRef<HTMLImageElement>(null);
  const spotEl = useRef<HTMLDivElement>(null);
  const bandEls = useRef<(HTMLDivElement | null)[]>([]);
  const hand = useRef<HTMLDivElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLDivElement>(null);
  const footerParts = useRef<(HTMLElement | null)[]>([]);
  const corners = useRef<(HTMLElement | null)[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLElement | null)[]>([]);
  const footer = useRef<HTMLDivElement>(null);
  const dots = useRef<(HTMLElement | null)[]>([]);
  const arrow = useRef<HTMLElement>(null);
  const check = useRef<HTMLElement>(null);
  const fillOn = useRef<HTMLElement>(null);
  const loopFill = useRef<HTMLElement>(null);
  const wire = useRef<HTMLDivElement>(null);
  const texts = useRef<(HTMLDivElement | null)[]>([]);
  const words = useRef<(HTMLElement | null)[][]>([]);
  const plans = useRef<Plan[]>([]);
  const geo = useRef<StepGeo[]>([]);

  const [active, setActive] = useState(false);
  // Sources from the first time the section shows, kept after (no reloads).
  const [seen, setSeen] = useState(false);
  const [aPlaying, setAPlaying] = useState(false);
  const activeRef = useRef(false);

  // Each step's text, measured once laid out (and again when the phone resizes): its lines, timing and height.
  useLayoutEffect(() => {
    if (!dims || !n) return;
    let live = true;
    const run = () => {
      if (!live) return;
      plans.current = steps.map((_, k) => {
        const block = texts.current[k];
        const els = (words.current[k] ?? []).filter((e): e is HTMLElement => !!e);
        if (!block || !els.length) return { units: [], total: 1, height: 40 };
        const box = block.getBoundingClientRect();
        // Measured unscaled: the card may be mid-flight, but its offsets are what count.
        const tops = els.map((e) => e.offsetTop);
        const xs = els.map((e) => (e.offsetLeft + e.offsetWidth / 2) / Math.max(1, block.offsetWidth));
        const plan = revealPlan('siri', linesFromTops(tops), xs);
        return { units: plan.units, total: plan.total, height: block.offsetHeight || box.height };
      });
      geo.current = geometry(steps, aspect, dims, cardW, plans.current);
      invalidate();
    };
    run();
    void document.fonts?.ready.then(run);
    return () => {
      live = false;
    };
  }, [dims, steps, n, aspect, cardW, invalidate]);

  // The video: plays the feed, or loops the current step in slow motion, getting there by an eased scrub.
  const video = useRef({ mode: -2, cancel: null as null | (() => void), loop: null as null | { from: number; to: number }, raf: 0 });
  const setMode = (m: number) => {
    const c = video.current;
    const v = videoB.current;
    if (!v || m === c.mode) return;
    c.mode = m;
    c.cancel?.();
    c.cancel = null;
    c.loop = null;
    if (m < 0) {
      v.playbackRate = 1;
      if (activeRef.current) v.play().catch(() => {});
      return;
    }
    const st = steps[m];
    if (!st) return;
    const end = Number.isFinite(v.duration) && v.duration > 0 ? v.duration - 0.06 : st.replay.to;
    const loop = { from: Math.min(st.replay.from, end - 0.5), to: Math.min(st.replay.to, end) };
    v.pause();
    c.cancel = runScrub(v, planScrub(v.currentTime, loop.from), () => {
      c.cancel = null;
      c.loop = loop;
      v.playbackRate = REPLAY_RATE;
      if (activeRef.current) v.play().catch(() => {});
      tick();
    });
  };
  // While a step loops: the loop's restart (the one allowed jump) and its progress line.
  const tick = () => {
    const c = video.current;
    const v = videoB.current;
    cancelAnimationFrame(c.raf);
    if (!v || !c.loop || !activeRef.current) return;
    if (v.currentTime >= c.loop.to) safeSeek(v, c.loop.from);
    paint(loopFill.current, `scaleX(${clamp01((v.currentTime - c.loop.from) / (c.loop.to - c.loop.from)).toFixed(4)})`);
    c.raf = requestAnimationFrame(tick);
  };
  useEffect(() => {
    const c = video.current;
    return () => {
      c.cancel?.();
      cancelAnimationFrame(c.raf);
    };
  }, []);
  useEffect(() => {
    const v = videoB.current;
    if (!v) return;
    if (!active) {
      v.pause();
      cancelAnimationFrame(video.current.raf);
    } else if (!video.current.cancel) {
      v.play().catch(() => {});
      tick();
    }
    // tick reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, walk]);

  useScene('scroll', ({ p, presence, dims: d }) => {
    const on = presence > 0.001;
    if (on !== activeRef.current) {
      activeRef.current = on;
      setActive(on);
      if (on) setSeen(true);
    }
    paint(layer.current, `scale(${(0.965 + 0.035 * presence).toFixed(4)})`, presence);
    const f = walkFrame(p, Math.max(1, n));
    const showA = on && f.swipe < 0.999;
    if (showA !== aPlaying) setAPlaying(showA);

    // The feed: the first clip slides up and away, the next comes up under it.
    const fh = feedHeight(d);
    paint(clipA.current, `translate3d(0, ${px(-f.swipe * fh)}, 0)`, 1);
    paint(clipB.current, `translate3d(0, ${px((1 - f.swipe) * fh)}, 0)`, 1);
    // The app's chrome fades while the double take is open (the tab bar's pill, the sound toggle, the clip's own).
    paint(chromeB.current, 'none', 1 - f.open);
    paint(chromeA.current, 'none', 1);
    paint(topBar.current, 'none', 1 - f.open);
    paint(tabBar.current, 'none', 1 - f.open);

    // The double tap: the gesture hint's hand, its press and lift run by the scroll.
    paintHand(hand.current, f.hand);

    const g = geo.current;
    if (!g.length || !n) {
      setMode(-1);
      return;
    }
    if (on) setMode(f.video);

    // Where things are between steps: the last step's place eased into this one's.
    const k = f.index;
    const prev = g[Math.max(0, k - 1)];
    const cur = g[k];
    const m = k > 0 ? f.at - (k - 1) : 1;
    const mix = (a: number, b: number) => lerp(a, b, m);
    const hole = { x: mix(prev.hole.x, cur.hole.x), y: mix(prev.hole.y, cur.hole.y), w: mix(prev.hole.w, cur.hole.w), h: mix(prev.hole.h, cur.hole.h) };

    // The spotlight: the hole image and four bands around it, by transform only.
    const r = maskPlacement(hole);
    const shade = dim * Math.min(1, f.open * 1.3);
    // Opaque pieces, the bands tucked a pixel under the image's edge, faded together (one
    // opacity on their group), so neither a light nor a dark seam shows where they meet.
    paint(spotEl.current, 'none', shade);
    paint(holeEl.current, `translate3d(${px(r.x + r.w / 2)}, ${px(r.y + r.h / 2)}, 0) scale(${(r.w / MASK_SIZE).toFixed(5)}, ${(r.h / MASK_SIZE).toFixed(5)})`, 1);
    dimBands(d.sw, fh, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }).forEach((b, i) =>
      paint(bandEls.current[i], `translate3d(${px(b.tx)}, ${px(b.ty)}, 0) scale(${b.sx.toFixed(5)}, ${b.sy.toFixed(5)})`, 1),
    );

    // The card: in from below its tell as the double take opens, then over to each next tell.
    const lift = f.lift;
    const side: 1 | -1 = d.popSide === 0 ? (k % 2 ? -1 : 1) : d.popSide;
    const lifted = values.card === 'lift' || d.pop <= 0;
    const popScale = d.narrow ? 1 : Math.min(1.15, 1 + 0.1 * d.pop);
    const out = lifted ? liftPlace(cur, side, d, cardW) : popPlace(cur, side, d, cardW, popScale);
    const L = easeInOut(lift);
    const h = mix(prev.h, cur.h);
    const x = lerp(mix(prev.x, cur.x), out.x, L);
    const y = lerp(mix(prev.y, cur.y), out.y, L) + (1 - f.open) * TRAVEL;
    // Out along an arc: a little further forward on the way than where it lands (lifted: straight up off the screen).
    const z = out.z * L + (lifted ? 0 : Math.sin(Math.PI * lift) * 26 * d.pop);
    const s = (0.96 + 0.04 * f.open) * lerp(1, out.scale, L);
    paint(card.current, `translate3d(${px(x)}, ${px(y)}, ${px(z)}) rotateY(${(out.rot * L).toFixed(3)}deg) scale(${s.toFixed(4)})`, f.open);
    paint(glass.current, `scaleY(${(h / 200).toFixed(4)})`, 1);
    paint(footer.current, `translate3d(0, ${px(h - FOOTER - BOTTOM)}, 0)`, 1);
    // The shadow falls away from the side it lifts toward, softly, as if lit from above.
    paint(shadow.current, `translate3d(${px(-side * (lifted ? 10 : 0) * L)}, ${px(h * 0.5 + (lifted ? 10 : 18) * L)}, 0) scale(1, ${(h / 200).toFixed(4)})`, L * (lifted ? 0.75 : 0.9));
    chips.current.forEach((el, j) => paint(el, `translate3d(0, ${px((1 - L) * 8)}, 0)`, !lifted && j === k ? L : 0));

    // The bottom row rises after the text (the app's order: the text, then the dots and arrows, one beat apart).
    const ref = plans.current[k];
    if (ref) {
      const ms = f.footer * fullMs(ref.total);
      const start = footerStart(ref.total);
      footerParts.current.forEach((el, i) => {
        const fr = revealFrame('siri', ms, { move: start + 12 * i, fade: start + 12 * i }, FOOTER_METRICS);
        paint(el, `translateY(${fr.translateY.toFixed(2)}px)`, fr.opacity);
      });
    }

    // The text: each step's words rise in line by line, and reverse out as the next comes.
    f.text.forEach((t, j) => {
      const plan = plans.current[j];
      const els = words.current[j];
      if (!plan || !els) return;
      const ms = t * fullMs(plan.total);
      paint(texts.current[j], 'none', t > 0 ? 1 : 0);
      plan.units.forEach((u, w) => {
        const fr = revealFrame('siri', ms, u, TEXT);
        paint(els[w], `translateY(${fr.translateY.toFixed(2)}px)`, fr.opacity);
      });
    });

    // Dots, and the forward arrow turning into a check on the last step.
    for (let i = 0; i < n; i++) {
      const dl = dotLook(f.at, i);
      paint(dots.current[i], `scale(${(1 + 0.3 * dl.current).toFixed(3)})`, 0.22 + 0.53 * dl.reached);
    }
    const ch = checkLook(f.at, n);
    paint(arrow.current, 'none', 1 - ch);
    paint(check.current, 'none', ch);
    paint(fillOn.current, 'none', ch);

    // The tell's corners, a little forward of the screen, and a line out to the card.
    // (Kept on the screen where the tell runs off its edge.)
    const cx0 = Math.max(10, hole.x);
    const cy0 = Math.max(10, hole.y);
    const cx1 = Math.min(d.sw - 10, hole.x + hole.w);
    const cy1 = Math.min(fh - 10, hole.y + hole.h);
    const cs = [
      [cx0, cy0],
      [cx1, cy0],
      [cx0, cy1],
      [cx1, cy1],
    ];
    cs.forEach(([cx, cy], i) => paint(corners.current[i], `translate3d(${px(cx)}, ${px(cy)}, ${px(lifted ? 0 : L * 18 * d.pop)})`, f.open * (lifted ? 0.8 : 0.55 + 0.45 * L)));
    if (!lifted && !d.narrow && d.pop > 0) {
      const x0 = side > 0 ? hole.x + hole.w : hole.x;
      const y0 = hole.y + hole.h / 2;
      const x1 = side > 0 ? x : x + cardW * s;
      const y1 = y + h / 2;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      paint(wire.current, `translate3d(${px(x0)}, ${px(y0)}, ${px(z * 0.5)}) rotate(${ang.toFixed(4)}rad) scaleX(${(len / 100).toFixed(4)})`, L * L);
    } else paint(wire.current, 'none', 0);

    // The phone turns a little toward the card that's out (lifted: hardly at all).
    return side * (lifted ? 1.5 : 6) * L * Math.min(1, d.pop);
  });

  const k = dims ? dims.sw / CANVAS_W : 1;
  const fh = dims ? feedHeight(dims) : 0;
  const chrome = (c: typeof walk | typeof other, ref: React.RefObject<HTMLDivElement | null>) =>
    c ? (
      <Canvas k={k}>
        <FeedChrome author={c.author} caption={c.caption} chromeRef={ref} />
      </Canvas>
    ) : null;

  return (
    <>
      <OnScreen layerRef={layer}>
          <div className="ft-clip" ref={clipA} style={{ bottom: 'auto', height: fh }}>
            <Clip src={seen ? other?.video : undefined} poster={other?.poster} playing={aPlaying} />
            {chrome(other, chromeA)}
          </div>
          <div className="ft-clip" ref={clipB} style={{ bottom: 'auto', height: fh }}>
            <Clip src={seen ? walk?.video : undefined} poster={walk?.poster} playing={false} videoRef={videoB} loop={false} />
            {chrome(walk, chromeB)}
            <div className="ft-spot" ref={spotEl} style={{ opacity: 0 }} aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="ft-band"
                  style={{ width: dims?.sw, height: fh }}
                  ref={(el) => {
                    bandEls.current[i] = el;
                  }}
                />
              ))}
              <img className="ft-hole" ref={holeEl} src={holeUri} alt="" />
            </div>
          </div>
          <Canvas k={k}>
            <AppTopBar barRef={topBar} />
            <AppTabBar active="home" barRef={tabBar} />
            <TapHand x={CANVAS_W / 2} y={380} handRef={hand} />
          </Canvas>
      </OnScreen>
      <AroundScreen>
        {[0, 1, 2, 3].map((i) => (
          <i
            key={i}
            className="ft-corner"
            data-corner={i}
            style={{ opacity: 0 }}
            ref={(el) => {
              corners.current[i] = el;
            }}
          />
        ))}
        <div className="ft-wire" ref={wire} style={{ opacity: 0 }} />
        <div className="ft-card" ref={card} style={{ width: cardW, opacity: 0 }}>
          <div className="ft-card-shadow" ref={shadow} />
          <div className="ft-glass" ref={glass} />
          {steps.map((st, k) => (
            <span
              key={k}
              className="ft-chip"
              style={{ opacity: 0 }}
              ref={(el) => {
                chips.current[k] = el;
              }}
            >
              <b>{st.time}</b> {st.label}
            </span>
          ))}
          {steps.map((st, k) => (
            <div
              key={k}
              className="ft-text"
              style={{ opacity: 0 }}
              ref={(el) => {
                texts.current[k] = el;
              }}
            >
              {revealWords(st.text).map((w, i) => (
                <span key={i}>
                  {i > 0 ? ' ' : null}
                  <span
                    className="ft-word"
                    ref={(el) => {
                      (words.current[k] ??= [])[i] = el;
                    }}
                  >
                    {w}
                  </span>
                </span>
              ))}
            </div>
          ))}
          <div className="ft-footer" ref={footer}>
            <span
              className="ft-fpart ft-status"
              style={{ opacity: 0 }}
              ref={(el) => {
                footerParts.current[0] = el;
              }}
            >
            <span className="ft-loop">
              <i ref={loopFill} />
            </span>
            <span className="ft-dots">
              {steps.map((_, i) => (
                <i
                  key={i}
                  ref={(el) => {
                    dots.current[i] = el;
                  }}
                />
              ))}
            </span>
            </span>
            <span className="ft-navs">
              <span
                className="ft-nav-btn ft-fpart"
                style={{ opacity: 0 }}
                ref={(el) => {
                  footerParts.current[1] = el;
                }}
              >
                <ChevronLeft size={16} />
              </span>
              <span
                className="ft-nav-btn ft-fpart"
                style={{ opacity: 0 }}
                ref={(el) => {
                  footerParts.current[2] = el;
                }}
              >
                <i className="ft-nav-fill" ref={fillOn} style={{ opacity: 0 }} />
                <span ref={arrow} className="ft-nav-icon">
                  <ChevronRight size={16} />
                </span>
                <span ref={check} className="ft-nav-icon ft-nav-check" style={{ opacity: 0 }}>
                  <Check size={16} />
                </span>
              </span>
            </span>
          </div>
        </div>
      </AroundScreen>
    </>
  );
}
