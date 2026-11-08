import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform } from 'react-native';
import { useDevPanel } from '@/devtools/store';
import { useAppSettings, useSettingsOpen } from '@/settings/store';
import { demoSteps, hintTimeout, SHOW_DELAY_MS, type HintEnd, type HintKind } from './hints';
import { HintView, type Step } from './HintView';
import { hints, useHints } from './store';
import './dev';

/**
 * A first-run hint over the active clip: a demo of the gestures that open the
 * double take (with Both, hold and then double tap), or, before that for a
 * brand-new viewer, how to swipe to the next clip. When it shows and goes is
 * decided in `hints.ts`; this reports what happened and `HintView` draws it.
 *
 * Mount one in each clip of a feed; only the active one ever draws. It counts
 * the double takes opened on its clip from `doubleTakeOpen` going true.
 */
export interface GestureHintProps {
  clipId: string;
  active: boolean;
  hasTells: boolean;
  /** The double take is open on this clip. */
  doubleTakeOpen: boolean;
  /** Something else holds or covers the clip: it's paused, a panel is open… */
  blocked?: boolean;
  /** `phone`: the swipe hint, no Space key. `desktop`: Space holds. */
  layout: 'phone' | 'desktop';
  /** Fades the hint with the feed's chrome (the phone's sheets). */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
}

/** A dev "Show now" waits this long for the panel to finish closing, ms. */
const REQUEST_DELAY_MS = 350;

export function GestureHint(p: GestureHintProps) {
  const s = useHints();
  const settingsOpen = useSettingsOpen();
  const devOpen = useDevPanel().open;
  const { revealGesture } = useAppSettings();
  const fine = usePointerFine();
  const reduceMotion = useReduceMotion();
  const mouse = s.input === 'mouse' || (s.input === 'auto' && fine);
  const still = s.input === 'still' || reduceMotion;
  const canSwipe = p.layout === 'phone' && !mouse;
  const covered = !p.active || p.doubleTakeOpen || !!p.blocked || settingsOpen || devOpen || s.blocks > 0;

  // What's drawn (kept through the fade-out) and whether it's on its way in.
  const [kind, setKind] = useState<HintKind | null>(null);
  const [on, setOn] = useState(false);
  const shown = useRef<HintKind | null>(null);
  // A hint that ran its course here doesn't start again on the same clip.
  const doneOn = useRef<string | null>(null);

  const hide = (why: HintEnd) => {
    const k = shown.current;
    if (!k) return;
    shown.current = null;
    if (why !== 'left') doneOn.current = p.clipId;
    hints.end(k, why);
    setOn(false);
  };

  useEffect(() => {
    if (p.active) hints.enterClip(p.clipId);
  }, [p.active, p.clipId]);

  // Opening a double take, by either gesture or the button, is what the hint
  // asks for: it goes at once, and the open counts towards learning it.
  const wasOpen = useRef(p.doubleTakeOpen);
  useEffect(() => {
    if (p.doubleTakeOpen && !wasOpen.current && p.active) {
      hints.recordOpen();
      if (shown.current === 'doubleTake') hide('gesture');
    }
    wasOpen.current = p.doubleTakeOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.doubleTakeOpen]);

  // A reset, "Show now" or "Keep showing" starts over, even on this clip.
  useEffect(() => {
    doneOn.current = null;
  }, [s.epoch]);

  // Covered or left: fade out, and it may come back on a later clip.
  useEffect(() => {
    if (covered) hide('left');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered]);

  // A clip that stays put for a moment gets the hint it should have; a dev
  // "Show now" plays on the first clip that can show it, whatever the rules.
  const request = s.request && (s.request.kind === 'swipe' ? canSwipe : p.hasTells) ? s.request : null;
  useEffect(() => {
    if (covered || on || (!request && doneOn.current === p.clipId)) return;
    const t = setTimeout(
      () => {
        const k = request ? request.kind : hints.hintFor({ clipId: p.clipId, hasTells: p.hasTells, blocked: false, canSwipe });
        if (!k) return;
        if (request) hints.takeRequest(request.id);
        hints.start(k);
        shown.current = k;
        setKind(k);
        setOn(true);
      },
      request ? REQUEST_DELAY_MS : SHOW_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [covered, on, p.clipId, p.hasTells, canSwipe, request, s.epoch, s.force]);

  const steps: Step[] = kind === 'swipe' ? ['swipe'] : demoSteps(revealGesture);

  // Twice through, then it goes by itself (with "Keep showing" it stays, for looking at).
  const timeout = hintTimeout(steps);
  useEffect(() => {
    if (!on || s.force !== 'off') return;
    const t = setTimeout(() => hide('timeout'), timeout);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, s.force, timeout]);

  // Gone for good on unmount (the clip scrolled out of the list).
  useEffect(
    () => () => hide('left'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Unmount the drawing once it has faded out, unless another hint started meanwhile.
  const onGone = useCallback(() => setKind((k) => (shown.current ? k : null)), []);

  if (!kind) return null;
  return (
    <HintView
      steps={steps}
      design={s.design}
      input={{ mouse, spaceKey: p.layout === 'desktop' }}
      still={still}
      on={on}
      opacity={p.opacity}
      onGone={onGone}
    />
  );
}

/** A mouse or trackpad (web, `pointer: fine`), not the screen's width. */
function usePointerFine(): boolean {
  const [fine, setFine] = useState(() => matchFine()?.matches ?? false);
  useEffect(() => {
    const mq = matchFine();
    if (!mq) return;
    const on = () => setFine(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return fine;
}

function matchFine(): MediaQueryList | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia('(pointer: fine)');
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
