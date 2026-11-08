import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Easing } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { HAND, HAND_TIP, RIPPLE, SPECS, frameAt } from '@/onboarding/HintView';
import { TABS, tabBarHeight } from '@/ui/TabBar';
import { paint } from '../engine';
import { showcaseTabs } from '../mock';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * A section's screen: clipped to the phone's screen, crossfading with the
 * other sections' as the page scrolls (`layerRef` takes the fade).
 */
export function OnScreen({ children, layerRef }: { children: ReactNode; layerRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ft-layer" ref={layerRef} style={{ opacity: 0 }}>
      {children}
    </div>
  );
}

/** A section's pieces around the screen, where cards come out (3D, in the phone's space). */
export function AroundScreen({ children }: { children: ReactNode }) {
  return <div className="ft-pops">{children}</div>;
}

/** The bottom safe area of the phone drawn (an iPhone's home indicator), points. */
const HOME_INSET = 34;
/** The app's tab bar strip at the bottom of the screen, points (the feed's video ends above it). Read when used (import cycle). */
export const tabStrip = () => tabBarHeight(HOME_INSET);
/** The status bar, points (the app's top bar sits just under it). */
const TOP_INSET = 54;

/**
 * The app's own tab bar (TabBar.tsx: a floating pill on a black strip, the
 * current tab's icon filled on a lighter pill), drawn in canvas points.
 */
export function AppTabBar({ active, barRef }: { active: string; barRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ft-tabbar" style={{ height: tabStrip() }} ref={barRef}>
      <div className="ft-tabpill">
        {/* Read at render: the app's tab module is part of an import cycle with the landing. */}
        {showcaseTabs(TABS).map((t) => {
          const on = t.id === active;
          return (
            <span key={t.id} className="ft-tab" data-on={on ? '' : undefined}>
              <Ionicons name={(on ? t.iconActive : t.icon) as IconName} size={t.id === 'create' ? 28 : 25} color="#f1f1f1" />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The feed's top bar (TopBar.tsx): just the sound toggle, top left. */
export function AppTopBar({ barRef }: { barRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ft-topbar" style={{ top: TOP_INSET + 2 }} ref={barRef}>
      <Ionicons name="volume-high-outline" size={25} color="#fff" />
    </div>
  );
}

/** The feed's chrome over a clip (ClipItem.tsx): the action rail and who posted it, in canvas points. */
export function FeedChrome({ author, caption, chromeRef }: { author: string; caption: string; chromeRef?: RefObject<HTMLDivElement | null> }) {
  const rail: [IconName, string][] = [
    ['heart-outline', '12.4K'],
    ['chatbox-ellipses-outline', '318'],
    ['repeat', '96'],
    ['arrow-redo-outline', '1.2K'],
    ['bookmark-outline', 'Save'],
  ];
  return (
    <div className="ft-chrome" ref={chromeRef} style={{ bottom: tabStrip() }}>
      <div className="ft-rail">
        {rail.map(([icon, label]) => (
          <span key={icon}>
            <Ionicons name={icon} size={30} color="#fff" />
            <small>{label}</small>
          </span>
        ))}
      </div>
      <div className="ft-meta">
        <div className="ft-author">
          <i className="ft-avatar">{author.slice(0, 1).toUpperCase()}</i>
          <b>@{author}</b>
          <em>Subscribe</em>
        </div>
        <p>{caption}</p>
        <div className="ft-audio">
          <Ionicons name="musical-notes" size={12} color="#ddd" /> Original audio
        </div>
      </div>
    </div>
  );
}

/**
 * The gesture hint's hand (onboarding/HintView.tsx: its glyph, drop shadow,
 * ripples and sizes), at (`x`, `y`) in canvas points. `paintHand` moves it
 * through the hint's double tap at any point of its loop.
 */
export function TapHand({ x, y, handRef }: { x: number; y: number; handRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ft-hand" style={{ left: x, top: y }} ref={handRef}>
      {SPECS.doubleTap.taps.map((_, i) => (
        <i key={i} className="ft-ripple" data-ripple="" style={{ width: RIPPLE, height: RIPPLE, margin: -RIPPLE / 2, opacity: 0 }} />
      ))}
      <div className="ft-hand-move" data-move="" style={{ opacity: 0 }}>
        <div className="ft-hand-at" data-shadow="">
          <span className="ft-hand-glyph ft-hand-shadow" style={{ left: -HAND * HAND_TIP.x, top: -HAND * HAND_TIP.y }}>
            <MaterialCommunityIcons name="hand-pointing-up" size={HAND} color="#000" />
          </span>
        </div>
        <div className="ft-hand-at" data-glyph="">
          <span className="ft-hand-glyph" style={{ left: -HAND * HAND_TIP.x, top: -HAND * HAND_TIP.y }}>
            <MaterialCommunityIcons name="hand-pointing-up" size={HAND} color="#f5f5f7" />
          </span>
        </div>
      </div>
    </div>
  );
}

interface HandParts {
  move: HTMLElement | null;
  shadow: HTMLElement | null;
  glyph: HTMLElement | null;
  ripples: HTMLElement[];
}

const handParts = new WeakMap<HTMLElement, HandParts>();

/** The hand's moving parts, looked up once. */
function partsOf(root: HTMLElement): HandParts {
  let p = handParts.get(root);
  if (!p) {
    p = {
      move: root.querySelector('[data-move]'),
      shadow: root.querySelector('[data-shadow]'),
      glyph: root.querySelector('[data-glyph]'),
      ripples: [...root.querySelectorAll<HTMLElement>('[data-ripple]')],
    };
    handParts.set(root, p);
  }
  return p;
}

const handEaseIn = Easing.inOut(Easing.cubic);

/**
 * The hint's double tap at `u` (0–1 of its loop), plus a way in and out: the
 * hand glides in from below and to the right while the hint idles before its
 * first tap, and glides away after it lifts off. Transforms and opacity only.
 */
export function paintHand(root: HTMLElement | null, u: number) {
  if (!root) return;
  const refs = partsOf(root);
  const spec = SPECS.doubleTap;
  const p = frameAt(spec.press, u);
  const lerpP = (up: number, down: number) => up + (down - up) * p;
  const firstTap = spec.taps[0];
  const lifted = spec.press[spec.press.length - 2][0];
  const inT = handEaseIn(Math.min(1, u / (firstTap - 0.06)));
  const outT = handEaseIn(Math.max(0, Math.min(1, (u - lifted) / (1 - lifted))));
  const away = (1 - inT) + outT;
  const shown = u <= 0 || u >= 1 ? 0 : Math.min(1, inT * 1.6) * (1 - outT);
  paint(refs.move, `translate3d(${(away * 90).toFixed(2)}px, ${(away * 150).toFixed(2)}px, 0) rotate(${(away * 12).toFixed(2)}deg)`, shown);
  const scale = lerpP(1.04, 0.95).toFixed(4);
  paint(refs.shadow, `translate3d(${lerpP(8, 2).toFixed(2)}px, ${lerpP(18, 5).toFixed(2)}px, 0) scale(${scale})`, lerpP(0.16, 0.3));
  paint(refs.glyph, `translate3d(0, ${lerpP(8, 0).toFixed(2)}px, 0) scale(${scale})`);
  spec.taps.forEach((at, i) => {
    const t = (u - at) / spec.ripple;
    const on = t >= 0 && t <= 1;
    paint(
      refs.ripples[i],
      `scale(${(0.4 + 1.3 * Easing.out(Easing.cubic)(Math.max(0, Math.min(1, t)))).toFixed(4)})`,
      on ? 0.9 * (1 - Easing.out(Easing.quad)(t)) : 0,
    );
  });
}

/**
 * A muted, inline clip that plays only while `playing` (and has its source
 * only once `src` is given: nothing loads before the section is near).
 */
export function Clip({
  src,
  poster,
  playing,
  videoRef,
  loop = true,
  className,
}: {
  src?: string;
  poster?: string;
  playing: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  loop?: boolean;
  className?: string;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [playing, src, ref]);
  return (
    <video
      ref={ref}
      className={className ?? 'ft-video'}
      src={src}
      poster={poster}
      muted
      playsInline
      loop={loop}
      preload={src ? 'auto' : 'none'}
      disablePictureInPicture
    />
  );
}

/** The size the screens are drawn at (an iPhone's points); `Canvas` scales it to the phone. */
export const CANVAS_W = 393;
export const CANVAS_H = 852;

/** A screen drawn at CANVAS_W × CANVAS_H points, scaled to the phone (set once per size, not per frame). */
export function Canvas({ k, children }: { k: number; children: ReactNode }) {
  return (
    <div className="ft-canvas" style={{ transform: `scale(${k})` }}>
      {children}
    </div>
  );
}

/** Keeps a latch of whether a scene has been on screen, and whether it is now (for its videos). */
export function useShown() {
  const on = useRef(false);
  const [state, setState] = useState({ on: false, seen: false });
  const update = (presence: number) => {
    const now = presence > 0.001;
    if (now === on.current) return;
    on.current = now;
    setState((s) => ({ on: now, seen: s.seen || now }));
  };
  return [state, update] as const;
}
