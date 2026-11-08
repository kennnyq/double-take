import { Platform } from 'react-native';

/**
 * Wheel ownership on web. The desktop feed listens for the wheel on the whole
 * window, so anything floating over it that scrolls on its own (or is modal)
 * must say so, or wheeling over it moves the feed and its own scrolling is
 * cancelled. The marker is `data-own-wheel`; RN-web modals (`aria-modal`)
 * count too.
 */
export const OWN_WHEEL_SELECTOR = '[data-own-wheel], [aria-modal="true"]';

/** Whether a wheel event's target belongs to something that keeps its own wheel. */
export function ownsWheel(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && target.closest(OWN_WHEEL_SELECTOR) !== null;
}

/** Spread on a React Native view to mark it (`data-own-wheel` on web; nothing on devices). */
export const ownWheelProps: object = Platform.OS === 'web' ? { dataSet: { ownWheel: '' } } : {};

/** Keeps a scroll view's wheel and touch scrolling from chaining on to the page at its ends (web). */
export const containOverscroll: object = Platform.OS === 'web' ? { overscrollBehavior: 'contain' } : {};
