import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { WheelGestureDetector, normalizeWheelDelta } from './wheelGesture';

/**
 * Drives a full-height, one-item-at-a-time vertical feed.
 *
 * Touch: the browser's native scroll-snap (`y mandatory` + `snap-stop: always`)
 * handles drag, flick physics and rubber-banding. Nothing in JS can match native
 * iOS/Android momentum, so we only observe where it settles.
 *
 * Wheel / trackpad / keyboard / buttons: native wheel scrolling over a snap
 * container feels mushy and can skip items, so we take over: a gesture detector
 * turns the event stream into discrete moves and we animate scrollTop ourselves
 * with a fast ease-out. Snap is disabled only while that animation runs.
 */

const DURATION_MS = 380;
// Fast start (responds instantly) with a soft landing.
const ease = (p: number) => 1 - Math.pow(1 - p, 4);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface FeedScroller {
  active: number;
  goTo: (index: number, instant?: boolean) => void;
  next: () => void;
  prev: () => void;
  /** True while a finger is on the feed or native momentum is still running. */
  isUserScrolling: () => boolean;
}

export function useFeedScroller(
  ref: RefObject<HTMLElement | null>,
  count: number,
  enabled = true,
): FeedScroller {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const targetRef = useRef(0);
  const countRef = useRef(count);
  useEffect(() => {
    countRef.current = count;
  }, [count]);
  const anim = useRef<{ raf: number } | null>(null);
  const touching = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);
  const detector = useRef(new WheelGestureDetector());

  const commit = useCallback((i: number) => {
    targetRef.current = i;
    if (activeRef.current !== i) {
      activeRef.current = i;
      setActive(i);
    }
  }, []);

  const stopAnimation = useCallback(() => {
    const el = ref.current;
    if (anim.current) {
      cancelAnimationFrame(anim.current.raf);
      anim.current = null;
    }
    if (el) el.style.scrollSnapType = '';
  }, [ref]);

  const goTo = useCallback(
    (index: number, instant = false) => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(countRef.current - 1, index));
      const h = el.clientHeight;
      const to = i * h;
      // Start playback of the incoming item right away; it slides in playing.
      commit(i);
      stopAnimation();
      const from = el.scrollTop;
      if (instant || prefersReducedMotion() || Math.abs(to - from) < 1) {
        el.scrollTop = to;
        return;
      }
      el.style.scrollSnapType = 'none';
      // The clock starts on the first frame, not now: the new clip's render can
      // hold up that frame, and starting earlier would skip most of the move.
      let start: number | null = null;
      const state = { raf: 0 };
      anim.current = state;
      const step = (now: number) => {
        if (anim.current !== state) return;
        start ??= now;
        const p = Math.min(1, (now - start) / DURATION_MS);
        el.scrollTop = from + (to - from) * ease(p);
        if (p < 1) state.raf = requestAnimationFrame(step);
        else {
          anim.current = null;
          el.scrollTop = to;
          el.style.scrollSnapType = '';
        }
      };
      state.raf = requestAnimationFrame(step);
    },
    [commit, ref, stopAnimation],
  );

  const next = useCallback(() => goTo(targetRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(targetRef.current - 1), [goTo]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const settle = () => {
      if (anim.current) return;
      const h = el.clientHeight;
      if (!h) return;
      commit(Math.max(0, Math.min(countRef.current - 1, Math.round(el.scrollTop / h))));
    };

    const onScroll = () => {
      if (anim.current) return;
      const h = el.clientHeight;
      const i = Math.round(el.scrollTop / h);
      // Landed exactly on a snap point: commit without waiting.
      if (Math.abs(el.scrollTop - i * h) < 1 && !touching.current) commit(i);
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        if (!touching.current) settle();
      }, 140);
    };

    // Listen on window: like Reels, wheeling anywhere on the page (side
    // columns, arrows, nav) drives the feed.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom on trackpads
      // Panels and dialogs that scroll on their own (comments, share) keep their wheel.
      if (e.target instanceof Element && e.target.closest('[data-own-wheel]')) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // allow back-swipe
      e.preventDefault();
      const dy = normalizeWheelDelta(e.deltaY, e.deltaMode, el.clientHeight);
      const dir = detector.current.push(dy, e.timeStamp);
      if (dir !== 0) goTo(targetRef.current + dir);
    };

    const onTouchStart = () => {
      touching.current = true;
      // A finger always wins over a programmatic animation.
      if (anim.current) stopAnimation();
    };
    const onTouchEnd = () => {
      touching.current = false;
      // If the finger lifted while already resting on a snap point, no further
      // scroll events arrive; settle explicitly.
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        if (!touching.current) settle();
      }, 160);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t?.closest?.('[aria-modal="true"]')) return; // a modal sheet/dialog owns the keyboard
      const down = e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j';
      const up = e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k';
      if (!down && !up) return;
      e.preventDefault();
      // Held keys: advance once per completed transition, not per repeat event.
      if (e.repeat && anim.current) return;
      if (down) next();
      else prev();
    };

    const ro = new ResizeObserver(() => {
      stopAnimation();
      el.scrollTop = activeRef.current * el.clientHeight;
    });

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', settle);
    window.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKey);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', settle);
      window.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(settleTimer.current);
      ro.disconnect();
      stopAnimation();
    };
  }, [commit, enabled, goTo, next, prev, ref, stopAnimation]);

  const isUserScrolling = useCallback(() => touching.current, []);

  return { active, goTo, next, prev, isUserScrolling };
}
