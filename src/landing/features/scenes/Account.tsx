import { useLayoutEffect, useRef } from 'react';
import { Bookmark, Grid3x3, Heart, Repeat2 } from 'lucide-react';
import { linesFromTops, revealFrame, revealMetrics, revealPlan, revealWords, type RevealUnit } from '@/feed/reveal';
import { paint, px, useHost, useScene } from '../engine';
import { clamp01, easeInOut, easeOut, lerp, plateau, seg } from '../timeline';
import { AroundScreen, CANVAS_W, Canvas, OnScreen } from './parts';

const NOTE = 'Three for three on hands today';
const NOTE_METRICS = revealMetrics({ fontSize: 12, lineHeight: 15 });
/** Likes, reposts, saves: the tabs it steps through, and what each pops out as. */
const TABS = [
  { Icon: Heart, label: 'Liked', n: 24 },
  { Icon: Repeat2, label: 'Reposted', n: 6 },
  { Icon: Bookmark, label: 'Saved', n: 11 },
];

/**
 * Profile: the guest screen, "Continue as guest" pressed, then the profile
 * assembles (avatar, numbers, its note's words rising in the way the card's
 * do) and steps through likes, reposts and saves, each coming out of the
 * screen beside the phone.
 */
export function AccountScene() {
  const { dims, media } = useHost();
  const k = dims ? dims.sw / CANVAS_W : 1;
  const posters = (media?.others ?? []).map((c) => c.poster).filter(Boolean) as string[];

  const layer = useRef<HTMLDivElement>(null);
  const guest = useRef<HTMLDivElement>(null);
  const press = useRef<HTMLElement>(null);
  const profile = useRef<HTMLDivElement>(null);
  const avatar = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const words = useRef<(HTMLElement | null)[]>([]);
  const plan = useRef<{ units: RevealUnit[]; total: number } | null>(null);
  const underline = useRef<HTMLElement>(null);
  const grids = useRef<(HTMLElement | null)[]>([]);
  const cells = useRef<(HTMLElement | null)[]>([]);
  const chips = useRef<(HTMLElement | null)[]>([]);
  const parts = useRef<(HTMLElement | null)[]>([]);

  // The note's words, measured once laid out (as the card's text is).
  useLayoutEffect(() => {
    const els = words.current.filter((e): e is HTMLElement => !!e);
    const box = note.current;
    if (!els.length || !box) return;
    const lines = linesFromTops(els.map((e) => e.offsetTop));
    const xs = els.map((e) => (e.offsetLeft + e.offsetWidth / 2) / Math.max(1, box.offsetWidth));
    const p = revealPlan('siri', lines, xs);
    plan.current = { units: p.units, total: p.total };
  }, [dims]);

  useScene('account', ({ p, presence, dims: d }) => {
    paint(layer.current, `scale(${(0.965 + 0.035 * presence).toFixed(4)})`, presence);
    // The guest screen; its "Continue as guest" pressed, and it gives way to the profile.
    const pressed = plateau(p, 0.1, 0.13, 0.16, 0.2);
    paint(press.current, 'none', pressed);
    const swap = easeInOut(seg(p, 0.16, 0.26));
    paint(guest.current, `translate3d(${px(-swap * 40)}, 0, 0)`, 1 - swap);
    paint(profile.current, `translate3d(${px((1 - swap) * 40)}, 0, 0)`, swap);

    // It assembles: the avatar, then the rest in order, rising a little.
    const av = easeOut(seg(p, 0.22, 0.32));
    paint(avatar.current, `scale(${lerp(0.6, 1, av).toFixed(4)})`, av);
    parts.current.forEach((el, i) => {
      const t = easeOut(seg(p, 0.25 + 0.03 * i, 0.33 + 0.03 * i));
      paint(el, `translate3d(0, ${px((1 - t) * 14)}, 0)`, t);
    });
    // The note: its bubble comes up, then its words rise in line by line.
    const bubble = easeOut(seg(p, 0.32, 0.37));
    paint(note.current, `translate3d(0, ${px((1 - bubble) * 10)}, 0) scale(${lerp(0.85, 1, bubble).toFixed(4)})`, bubble);
    const pl = plan.current;
    if (pl) {
      const ms = seg(p, 0.34, 0.5) * pl.total;
      pl.units.forEach((u, i) => {
        const f = revealFrame('siri', ms, u, NOTE_METRICS);
        paint(words.current[i], `translateY(${f.translateY.toFixed(2)}px)`, f.opacity);
      });
    }

    // Likes, reposts, saves: the underline slides along the tabs, the grid crossfades.
    // (A guest has no posts: it opens on likes.)
    const tab = 1 + easeInOut(seg(p, 0.5, 0.55)) + easeInOut(seg(p, 0.66, 0.71));
    paint(underline.current, `translate3d(${px(tab * (CANVAS_W / 4))}, 0, 0)`);
    grids.current.forEach((el, i) => paint(el, 'none', clamp01(1 - Math.abs(tab - (i + 1)))));
    cells.current.forEach((el, i) => paint(el, 'none', easeOut(seg(p, 0.27 + 0.012 * i, 0.33 + 0.012 * i))));

    // Each comes out of the screen as its tab shows, and the three settle back together at the end.
    const s = d.popSide === -1 ? -1 : 1;
    TABS.forEach((_, i) => {
      const el = chips.current[i];
      if (!el) return;
      const start = [0.42, 0.56, 0.72][i];
      const lift = easeInOut(plateau(p, start, start + 0.07, 0.9, 0.98));
      const from = { x: ((i + 1.5) * CANVAS_W) / 4 * k - 60, y: 360 * k };
      const w = el.offsetWidth || 150;
      const out = d.narrow || d.pop <= 0
        ? { x: 12 + i * ((d.sw - 24) / 3), y: d.sh * 0.78 - 40, z: 40 * d.pop }
        : { x: s > 0 ? d.sw + Math.min(36 + 30 * d.pop + (i % 2) * 30, Math.max(8, d.roomR - w - 20)) : -Math.min(36 + 30 * d.pop + (i % 2) * 30, Math.max(8, d.roomL - w - 20)) - w, y: d.sh * 0.3 + i * 70, z: 60 * d.pop };
      paint(
        el,
        `translate3d(${px(lerp(from.x, out.x, lift))}, ${px(lerp(from.y, out.y, lift))}, ${px(out.z * lift + Math.sin(Math.PI * lift) * 34 * d.pop)}) rotateY(${(s * 10 * lift * Math.min(1, d.pop)).toFixed(2)}deg) scale(${lerp(0.7, d.narrow ? 0.82 : 1, lift).toFixed(4)})`,
        Math.min(1, lift * 3) * presence,
      );
    });
  });

  const part = (i: number) => (el: HTMLElement | null) => {
    parts.current[i] = el;
  };
  let cell = 0;
  return (
    <>
      <OnScreen layerRef={layer}>
        <Canvas k={k}>
          <div className="ft-guest ft-a" ref={guest}>
            <h3>Your profile</h3>
            <p>Sign in to keep your likes, saves and reposts, and pick up where you left off on any device.</p>
            <span className="ft-pill">Sign in or sign up</span>
            <span className="ft-pill ft-pill-quiet" style={{ position: 'relative' }}>
              Continue as guest
              <i className="ft-press" ref={press} />
            </span>
          </div>
          <div className="ft-profile ft-a" ref={profile} style={{ opacity: 0 }}>
            <p className="ft-ptitle" ref={part(0)}>
              guest
            </p>
            <div className="ft-phead">
              <div className="ft-bigavatar ft-a" ref={avatar}>
                G
                <div className="ft-pnote ft-a" ref={note} style={{ opacity: 0 }}>
                  {revealWords(NOTE).map((w, i) => (
                    <span key={i}>
                      {i > 0 ? ' ' : null}
                      <span
                        className="ft-word"
                        ref={(el) => {
                          words.current[i] = el;
                        }}
                      >
                        {w}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="ft-stats ft-a" ref={part(1)}>
                <span>
                  <b>0</b>posts
                </span>
                <span>
                  <b>0</b>followers
                </span>
                <span>
                  <b>12</b>following
                </span>
              </div>
            </div>
            <p className="ft-pname ft-a" ref={part(2)}>
              Guest
            </p>
            <div className="ft-pbtns ft-a" ref={part(3)}>
              <span>Sign in to save across devices</span>
            </div>
            <div className="ft-ptabs ft-a" ref={part(4)}>
              <span>
                <Grid3x3 size={22} />
              </span>
              {TABS.map(({ Icon }, i) => (
                <span key={i}>
                  <Icon size={22} />
                </span>
              ))}
              <i ref={underline} />
            </div>
            <div className="ft-grid">
              {[1, 2, 3].map((g) => (
                <div
                  key={g}
                  className="ft-a"
                  style={{ opacity: g === 1 ? 1 : 0 }}
                  ref={(el) => {
                    grids.current[g - 1] = el;
                  }}
                >
                  {Array.from({ length: 9 }, (_, i) => {
                    const src = posters.length ? posters[(g * 3 + i) % posters.length] : undefined;
                    const c = cell++;
                    const ref = (el: HTMLElement | null) => {
                      cells.current[c] = el;
                    };
                    return src ? <img key={i} src={src} alt="" ref={ref} className="ft-a" loading="lazy" /> : <em key={i} ref={ref} className="ft-a" />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </Canvas>
      </OnScreen>
      <AroundScreen>
        {TABS.map(({ Icon, label, n }, i) => (
          <div
            key={label}
            className="ft-social ft-a"
            style={{ opacity: 0 }}
            ref={(el) => {
              chips.current[i] = el;
            }}
          >
            <i>
              <Icon size={16} />
            </i>
            {label} · {n}
          </div>
        ))}
      </AroundScreen>
    </>
  );
}
