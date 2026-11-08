import { DOUBLE_TAP_MS, revealsWith, type Timers } from './gesture.ts';
import type { RevealGesture } from './settings.ts';

interface Press {
  mode: RevealGesture;
  hasTells: boolean;
  holdMs: number;
  onSingle: () => void;
  onReveal: () => void;
}

/** Space's two distinct presses share the pointer double-tap window.
 * A held key never counts its auto-repeats as taps or advances before release.
 */
export function createSpaceRecognizer(
  timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
  now: () => number = () => performance.now(),
) {
  let down: { at: number; press: Press; consumed: boolean } | null = null;
  let last: number | null = null;
  let hold: unknown = null;
  let single: unknown = null;
  const clearHold = () => { if (hold !== null) timers.clear(hold); hold = null; };
  const clearSingle = () => { if (single !== null) timers.clear(single); single = null; };
  const cancel = () => { clearHold(); clearSingle(); down = null; last = null; };
  return {
    down(press: Press) {
      if (down) return;
      const at = now();
      const doubles = press.hasTells && revealsWith('doubleTap', press.mode);
      down = { at, press, consumed: false };
      if (doubles && last !== null && at - last < DOUBLE_TAP_MS) {
        clearSingle();
        last = null;
        down.consumed = true;
        press.onReveal();
        return;
      }
      last = null;
      if (press.hasTells && revealsWith('hold', press.mode)) {
        hold = timers.set(() => {
          hold = null;
          if (!down) return;
          down.consumed = true;
          clearSingle();
          last = null;
          press.onReveal();
        }, press.holdMs);
      } else if (!doubles) {
        down.consumed = true;
        press.onSingle();
      }
    },
    up() {
      if (!down) return;
      const p = down;
      down = null;
      clearHold();
      if (p.consumed) return;
      if (p.press.hasTells && revealsWith('doubleTap', p.press.mode)) {
        const remaining = DOUBLE_TAP_MS - (now() - p.at);
        if (remaining > 0) {
          last = p.at;
          single = timers.set(() => {
            single = null;
            last = null;
            p.press.onSingle();
          }, remaining);
          return;
        }
      }
      last = null;
      p.press.onSingle();
    },
    cancel,
  };
}
