import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { useDevPanel } from '@/devtools/store';
import { useHintViewer } from './viewer';
import { useGate } from '@/auth/gate';
import { useAppSettings, useSettingsOpen } from '@/settings/store';
import { HintView } from './HintView';
import { hints, useHints } from './store';
import './dev';

/**
 * A first-run hint over the active clip: a demo of the gestures that open the
 * double take ("Hold or double tap" with Both, the default). When it shows and goes
 * is decided in `hints.ts`; this reports what happened and `HintView` draws it.
 *
 * Mount one in each clip of a feed; only the active, uncovered one draws.
 * It loops until the clip is left or a double take is opened.
 */
export interface GestureHintProps {
  clipId: string;
  active: boolean;
  hasTells: boolean;
  /** The double take is open on this clip. */
  doubleTakeOpen: boolean;
  /** Something else holds or covers the clip: it's paused, a panel is open… */
  blocked?: boolean;
  /** Which feed it's in: `desktop` (the desktop web feed) or `phone`. */
  layout: 'phone' | 'desktop';
  /** Fades the hint with the feed's chrome (the phone's sheets). */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
}

/** A dev "Show now" waits this long for the panel to finish closing, ms. */
const REQUEST_DELAY_MS = 350;

export function GestureHint(p: GestureHintProps) {
  const s = useHints();
  const { status } = useHintViewer();
  const signInOpen = useGate().open;
  const foreground = useForeground();
  const settingsOpen = useSettingsOpen();
  const devOpen = useDevPanel().open;
  const { revealGesture } = useAppSettings();
  const fine = usePointerFine();
  const reduceMotion = useReduceMotion();
  const mouse = s.input === 'mouse' || (s.input === 'auto' && fine);
  const still = s.input === 'still' || reduceMotion;
  // The dev settings panel covers the clip on phones; on desktop it floats beside the card.
  const panelCovers = devOpen && p.layout === 'phone';
  const covered = !foreground || status === 'loading' || signInOpen || !p.active || p.doubleTakeOpen || !!p.blocked || settingsOpen || panelCovers || s.blocks > 0;
  // The hand is an icon font: it loads on first use, and until it has, the
  // words would show without it. Wait for it, so the hand always leads.
  const [iconsLoaded, iconsFailed] = useFonts(MaterialCommunityIcons.font);
  const ready = iconsLoaded || !!iconsFailed || s.design !== 'hand';

  // Whether it's drawn (kept through the fade-out), and whether it's on its way in.
  const [drawn, setDrawn] = useState(false);
  const [on, setOn] = useState(false);
  const shown = useRef(false);
  const hide = useCallback(() => {
    shown.current = false;
    setOn(false);
  }, []);

  // The existing walkthrough-open signal covers successful hold, double tap,
  // Space and the explicit double-take button, even before the hint appears.
  const wasOpen = useRef(p.doubleTakeOpen);
  useEffect(() => {
    if (p.doubleTakeOpen && !wasOpen.current && p.active) {
      hints.recordOpen();
      hide();
    }
    wasOpen.current = p.doubleTakeOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.doubleTakeOpen]);

  // Keep the drawing mounted through its exit, including when another clip
  // reports a successful open. Force/Show now can still preview learned hints.
  useEffect(() => {
    // Animate the exit when an external screen/clip takes over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (covered) hide();
  }, [covered, hide]);

  // A clip that stays put for a moment shows the hint if it should; a dev
  // "Show now" plays on the first clip with tells, whatever the rules.
  const request = s.request && p.hasTells ? s.request : null;
  useEffect(() => {
    if (covered || !ready || on) return;
    const t = setTimeout(
      () => {
        if (request) hints.takeRequest(request.id);
        else if (!hints.shouldShow({ hasTells: p.hasTells, blocked: false })) return;
        shown.current = true;
        setDrawn(true);
        setOn(true);
      },
      request ? REQUEST_DELAY_MS : s.delayMs,
    );
    return () => clearTimeout(t);
  }, [covered, ready, on, p.clipId, p.hasTells, request, s.epoch, s.force, s.delayMs]);

  // Unmount the drawing once it has faded out, unless another hint started meanwhile.
  const onGone = useCallback(() => setDrawn(shown.current), []);

  if (!drawn) return null;
  return (
    <HintView
      demo={revealGesture}
      design={s.design}
      mouse={mouse}
      still={still}
      on={on}
      opacity={p.opacity}
      onGone={onGone}
    />
  );
}

/** Hide tutorials while the app or browser tab is in the background. */
function useForeground(): boolean {
  const [active, setActive] = useState(() => Platform.OS === 'web' ? typeof document === 'undefined' || !document.hidden : AppState.currentState === 'active');
  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => setActive(!document.hidden);
      document.addEventListener('visibilitychange', update);
      return () => document.removeEventListener('visibilitychange', update);
    }
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
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
