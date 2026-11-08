import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform } from 'react-native';
import { useDevPanel } from '@/devtools/store';
import { useAppSettings, useSettingsOpen } from '@/settings/store';
import { demoSteps, hintTimeout, SHOW_DELAY_MS, type HintEnd } from './hints';
import { HintView } from './HintView';
import { hints, useHints } from './store';
import './dev';

/**
 * A first-run hint over the active clip: a demo of the gestures that open the
 * double take (with Both, hold and then double tap). When it shows and goes
 * is decided in `hints.ts`; this reports what happened and `HintView` draws it.
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
  /** `phone`: holds and taps. `desktop`: Space holds, with a mouse. */
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
  // The dev settings panel covers the clip on phones; on desktop it floats beside the card.
  const panelCovers = devOpen && p.layout === 'phone';
  const covered = !p.active || p.doubleTakeOpen || !!p.blocked || settingsOpen || panelCovers || s.blocks > 0;

  // Whether it's drawn (kept through the fade-out), and whether it's on its way in.
  const [drawn, setDrawn] = useState(false);
  const [on, setOn] = useState(false);
  const shown = useRef(false);
  // A hint that ran its course here doesn't start again on the same clip.
  const doneOn = useRef<string | null>(null);

  const hide = (why: HintEnd) => {
    if (!shown.current) return;
    shown.current = false;
    if (why !== 'left') doneOn.current = p.clipId;
    hints.end(why);
    setOn(false);
  };

  // Opening a double take, by either gesture or the button, is what the hint
  // asks for: it goes at once, and the open counts towards learning it.
  const wasOpen = useRef(p.doubleTakeOpen);
  useEffect(() => {
    if (p.doubleTakeOpen && !wasOpen.current && p.active) {
      hints.recordOpen();
      hide('gesture');
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

  // A clip that stays put for a moment shows the hint if it should; a dev
  // "Show now" plays on the first clip with tells, whatever the rules.
  const request = s.request && p.hasTells ? s.request : null;
  useEffect(() => {
    if (covered || on || (!request && doneOn.current === p.clipId)) return;
    const t = setTimeout(
      () => {
        if (request) hints.takeRequest(request.id);
        else if (!hints.shouldShow({ hasTells: p.hasTells, blocked: false })) return;
        hints.start();
        shown.current = true;
        setDrawn(true);
        setOn(true);
      },
      request ? REQUEST_DELAY_MS : SHOW_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [covered, on, p.clipId, p.hasTells, request, s.epoch, s.force]);

  const steps = demoSteps(revealGesture);

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
  const onGone = useCallback(() => setDrawn(shown.current), []);

  if (!drawn) return null;
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
