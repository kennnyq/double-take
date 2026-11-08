import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';
import { loadDemo, type DemoMedia } from './demo';
import { SECTION_WORDS } from './content';
import type { FeatureValues } from './designs';
import { SceneContext, paint, px, type Dims, type SceneApply, type SceneHost } from './engine';
import {
  FOLLOW_TAU,
  LENGTH_SCALE,
  SECTION_IDS,
  current,
  easeInOut,
  follow,
  layoutSections,
  localProgress,
  presence,
  seg,
  type SectionId,
} from './timeline';
import { WalkScene } from './scenes/Walk';
import { UploadScene } from './scenes/Upload';
import { GameScene } from './scenes/Game';
import { SkillsScene } from './scenes/Skills';
import { AccountScene } from './scenes/Account';
import './features.css';

/** iPhone screen proportions (width / height). */
const SCREEN = 393 / 852;
/** Screens over which neighbouring sections cross over. */
const CROSS = 0.5;
/** How far the phone turns in each section (deg), before the knob scales it. */
const TURN: Record<SectionId, number> = { scroll: -9, upload: 7, game: -6, skills: 8, account: -5 };
const TILT = { none: 0, some: 1, more: 1.8 } as const;
const POP = { off: 0, subtle: 0.45, full: 1, wild: 1.5 } as const;

const SCENES: Record<SectionId, () => React.JSX.Element> = {
  scroll: WalkScene,
  upload: UploadScene,
  game: GameScene,
  skills: SkillsScene,
  account: AccountScene,
};

function measure(W: number, H: number, v: FeatureValues): Dims {
  const narrow = W < 760;
  const pop = POP[v.pop];
  if (narrow) {
    const top = Math.min(200, H * 0.24);
    const avail = H - top - 28;
    const sh = Math.min(avail, (W - 56) / SCREEN);
    const sw = sh * SCREEN;
    const sx = (W - sw) / 2;
    return { W, H, narrow, sx, sy: top + (avail - sh) / 2, sw, sh, roomL: sx, roomR: sx, popSide: 1, pop: pop && 0.35, railY: null };
  }
  const sh = Math.min(H * 0.8, 780);
  const sw = sh * SCREEN;
  const cx = v.layout === 'side' ? W * 0.6 : v.layout === 'rail' ? W * 0.3 : W / 2;
  const sx = cx - sw / 2;
  const sy = (H - sh) / 2 - (v.nav === 'none' ? 0 : 10);
  return {
    W,
    H,
    narrow,
    sx,
    sy,
    sw,
    sh,
    roomL: sx - 24,
    roomR: W - sx - sw - 24,
    popSide: v.layout === 'stage' ? 0 : 1,
    pop,
    railY: v.layout === 'rail' ? sh * 0.62 : null,
  };
}

/**
 * The features below the hero: a phone pinned to the screen while the page
 * scrolls through what the app does, Apple-style. The scroll drives every
 * motion (one frame loop, only while the section is on screen), so it can be
 * scrubbed both ways and stopped anywhere.
 */
export function Features({ rootRef, values: v }: { rootRef: RefObject<HTMLElement | null>; values: FeatureValues }) {
  const ids = useMemo(() => SECTION_IDS.filter((id) => v[id] === 'on'), [v]);
  const layout = useMemo(() => layoutSections(ids, LENGTH_SCALE[v.length]), [ids, v.length]);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [media, setMedia] = useState<DemoMedia | null>(null);
  const [stageH, setStageH] = useState(0);
  const scenes = useRef(new Map<SectionId, SceneApply>());
  const kick = useRef<() => void>(() => {});

  // The stage's size (and so the phone's) on load and resize.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const read = () => {
      setStageH(stage.clientHeight);
      setDims(measure(stage.clientWidth, stage.clientHeight, v));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [v]);

  // The clips: only once the section comes within a screen or so.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void loadDemo().then((m) => live && setMedia(m));
      },
      { root: rootRef.current, rootMargin: '120% 0px' },
    );
    io.observe(track);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [rootRef]);

  const register = useCallback((id: SectionId, apply: SceneApply) => {
    scenes.current.set(id, apply);
    kick.current();
    return () => {
      if (scenes.current.get(id) === apply) scenes.current.delete(id);
    };
  }, []);
  const invalidate = useCallback(() => kick.current(), []);
  const host = useMemo<SceneHost>(
    () => ({ register, dims, media, values: v, invalidate }),
    [register, dims, media, v, invalidate],
  );

  // The frame loop: runs while the scroll position (smoothed) is moving, and the section is on screen.
  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!root || !track || !stage || !dims) return;
    const tau = FOLLOW_TAU[v.follow];
    const tilt = TILT[v.tilt];
    const copies = [...stage.querySelectorAll<HTMLElement>('[data-copy]')];
    const navItems = [...stage.querySelectorAll<HTMLElement>('[data-nav-fill]')];
    const navLabels = [...stage.querySelectorAll<HTMLElement>('[data-nav-label]')];
    const words = [...stage.querySelectorAll<HTMLElement>('[data-word]')];
    const glow = stage.querySelector<HTMLElement>('[data-glow]');
    const rail = stage.querySelector<HTMLElement>('[data-rail]');
    const shown = new Map<SectionId, number>();
    let top = 0;
    const readTop = () => {
      top = track.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    };
    readTop();
    const target = () => (root.scrollTop - top) / dims.H;
    let pos = target();
    let raf = 0;
    let last = performance.now();
    let visible = true;

    // Development: browser checks read each frame's own cost from `window.__ftCost` (when they set it).
    const costs = (window as unknown as { __ftCost?: number[] }).__ftCost;
    const frame = (now: number) => {
      raf = 0;
      const began = costs ? performance.now() : 0;
      const dt = Math.min(64, now - last);
      last = now;
      const goal = target();
      pos = follow(pos, goal, dt, tau, 0.0005);
      let turn = 0;
      let railAt = 0;
      layout.sections.forEach((s, i) => {
        const pr = presence(s, pos, CROSS, i === 0, i === layout.sections.length - 1);
        const p = localProgress(s, pos);
        turn += pr * TURN[s.id];
        if (i > 0) railAt += easeInOut(seg(pos, s.start - 0.45, s.start + 0.45));
        // Copy: in from below as the section starts, out upwards as it ends.
        const copy = copies[i];
        if (copy) {
          if (v.layout === 'rail' && !dims.narrow) paint(copy, 'none', 1);
          else {
            const dir = p < 0.5 ? 1 : -1;
            paint(copy, `translate3d(0, ${px((1 - pr) * 48 * dir)}, 0)`, pr);
          }
          const vis = pr > 0.001 || (v.layout === 'rail' && !dims.narrow) ? 'visible' : 'hidden';
          if (copy.style.visibility !== vis) copy.style.visibility = vis;
        }
        paint(words[i], `translate3d(0, ${px((1 - pr) * 70 * (p < 0.5 ? 1 : -1))}, 0) scale(${(0.94 + 0.06 * pr).toFixed(4)})`, pr);
        paint(navLabels[i], 'none', 0.42 + 0.58 * pr);
        const apply = scenes.current.get(s.id);
        // A scene is called while it's on screen, and once more as it leaves (to settle at 0).
        if (apply && (pr > 0 || (shown.get(s.id) ?? 1) > 0)) {
          const extra = apply({ p, presence: pr, dims, dt });
          if (typeof extra === 'number') turn += extra * pr;
        }
        shown.set(s.id, pr);
      });
      const at = current(layout, pos);
      navItems.forEach((el, i) => paint(el, `scaleX(${i < at.index ? 1 : i === at.index ? at.p.toFixed(4) : 0})`, 1));
      if (rail) {
        const pitch = dims.W * 0.5;
        paint(rail, `translate3d(${px(-railAt * pitch)}, 0, 0)`, 1);
        copies.forEach((c, i) => {
          const d = i - railAt;
          // Passed panels fade away (they slide behind the phone); the next one waits, dimmed.
          if (v.layout === 'rail' && !dims.narrow) paint(c, `translate3d(${px(i * pitch)}, 0, 0)`, d < 0 ? Math.max(0, 1 + d * 1.4) : Math.max(0.22, 1 - d * 0.78));
        });
      }
      paint(deviceRef.current, `rotateY(${(turn * tilt).toFixed(3)}deg) rotateX(${(tilt ? 2 : 0).toFixed(1)}deg)`, 1);
      paint(glow, 'none', Math.max(0, Math.min(1, 1 - Math.max(0, -pos) * 1.2)));
      if (Math.abs(pos - goal) > 0.0005) schedule();
      costs?.push(performance.now() - began);
    };
    const schedule = () => {
      if (!raf && visible) {
        last = Math.min(last, performance.now() - 16);
        raf = requestAnimationFrame(frame);
      }
    };
    kick.current = schedule;
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible) {
          readTop();
          pos = target();
          schedule();
        }
      },
      { root },
    );
    io.observe(track);
    const onScroll = () => schedule();
    root.addEventListener('scroll', onScroll, { passive: true });
    schedule();
    return () => {
      kick.current = () => {};
      io.disconnect();
      root.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [rootRef, dims, layout, v]);

  // The index: jumping to a section scrolls there (navigation).
  const jump = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const root = rootRef.current;
      const track = trackRef.current;
      const i = Number(e.currentTarget.dataset.index);
      const s = layout.sections[i];
      if (!root || !track || !s || !dims) return;
      const top = track.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTo({ top: top + (s.start + (i === 0 ? 0 : 0.05)) * dims.H, behavior: 'smooth' });
    },
    [rootRef, layout, dims],
  );

  if (!ids.length) return null;
  const narrow = dims?.narrow ?? false;
  return (
    <SceneContext.Provider value={host}>
      <section
        className="ft"
        id="features"
        ref={trackRef}
        data-exit=""
        data-layout={v.layout}
        data-narrow={narrow ? '' : undefined}
        data-device={v.device}
        data-ids={ids.join(',')}
        data-starts={layout.sections.map((s) => s.start.toFixed(3)).join(',')}
        style={{ height: stageH ? (layout.total + 1) * stageH : `${(layout.total + 1) * 100}svh` }}
      >
        <div className="ft-stage" ref={stageRef}>
          {dims && (
            <>
              {v.glow !== 'none' && (
                <div className="ft-glow" data-glow="" data-kind={v.glow} style={{ left: dims.sx + dims.sw / 2, top: dims.sy + dims.sh / 2 }}>
                  {v.glow === 'poster' && media?.walk.poster && <img src={media.walk.poster} alt="" />}
                </div>
              )}
              {v.layout === 'stage' && !narrow && (
                <div className="ft-words" aria-hidden>
                  {ids.map((id) => (
                    <span key={id} data-word="" style={{ opacity: 0 }}>
                      {SECTION_WORDS[id].title}
                    </span>
                  ))}
                </div>
              )}
              <div className="ft-copies" data-rail={v.layout === 'rail' && !narrow ? '' : undefined}>
                {ids.map((id, i) => (
                  <div key={id} className="ft-copy" data-copy="" style={{ opacity: 0 }}>
                    <p className="ft-eyebrow">
                      {v.layout === 'rail' && <span className="ft-num">0{i + 1}</span>}
                      {SECTION_WORDS[id].name}
                    </p>
                    <h2 className="ft-title">{SECTION_WORDS[id].title}</h2>
                    <p className="ft-body">{SECTION_WORDS[id].body}</p>
                  </div>
                ))}
              </div>
              <div className="ft-scene">
                <div
                  className="ft-device"
                  ref={deviceRef}
                  style={{ left: dims.sx, top: dims.sy, width: dims.sw, height: dims.sh, '--r': `${Math.round(dims.sw * 0.13)}px` } as React.CSSProperties}
                >
                  {v.device !== 'bare' && <div className="ft-bezel" />}
                  <div className="ft-screen" />
                  {ids.map((id) => {
                    const Scene = SCENES[id];
                    return <Scene key={id} />;
                  })}
                  <div className="ft-status" aria-hidden>
                    <span>9:41</span>
                    <span>
                      <Signal size={13} strokeWidth={2.6} />
                      <Wifi size={13} strokeWidth={2.6} />
                      <BatteryFull size={17} strokeWidth={2} />
                    </span>
                  </div>
                  {v.device !== 'bare' && <div className="ft-island" />}
                </div>
              </div>
              {v.nav !== 'none' && (
                <nav className="ft-nav" aria-label="Features">
                  {ids.map((id, i) => (
                    <button key={id} type="button" data-index={i} onClick={jump}>
                      <span data-nav-label="">{SECTION_WORDS[id].name}</span>
                      <i>
                        <b data-nav-fill="" />
                      </i>
                    </button>
                  ))}
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </SceneContext.Provider>
  );
}
