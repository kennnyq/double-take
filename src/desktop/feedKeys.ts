/**
 * Who a key press belongs to on the desktop feed. Pure (it only reads a few
 * element properties), so it runs under `node --test`.
 *
 * Clicking a feed button (Unmute, Like, Double take, a rail item) leaves it
 * focused. Browsers then give Space to that button: holding Space would press
 * it instead of opening the double take. So Space goes to the feed unless
 * the viewer is typing, a dialog is open, or they reached a control with the
 * keyboard (Tab), where Space should still activate it.
 *
 * `:focus-visible` can't tell those apart: Chrome turns it on for a clicked
 * button as soon as a key is pressed, Space included. So the feed tracks how
 * focus arrived itself (`createFocusTracker`).
 */

/** The bits of an element this needs; a DOM `Element` has them all. */
export interface KeyTarget {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
}

export type KeyOwner =
  /** A text field: every key is typing. */
  | 'typing'
  /** Inside an open dialog or sheet, which owns the keyboard. */
  | 'dialog'
  /** A control reached with the keyboard: Space and Enter activate it. */
  | 'control'
  /** The feed: Space plays/pauses, or opens the double take when held/double-tapped; M mutes. */
  | 'feed';

const TEXT_FIELDS = /^(INPUT|TEXTAREA|SELECT)$/;
const CONTROL_TAGS = /^(BUTTON|A|SUMMARY)$/;
const CONTROL_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option']);

/** `keyboardFocus`: the focus last moved by keyboard (Tab), not by a click. */
export function keyOwner(target: KeyTarget | null | undefined, keyboardFocus: boolean): KeyOwner {
  // The page itself (body, the feed) or nothing focused.
  if (!target || typeof target.closest !== 'function') return 'feed';
  if (target.isContentEditable || TEXT_FIELDS.test(target.tagName)) return 'typing';
  if (target.closest('[aria-modal="true"]')) return 'dialog';
  const control = CONTROL_TAGS.test(target.tagName) || CONTROL_ROLES.has(target.getAttribute('role') ?? '');
  if (control && keyboardFocus) return 'control';
  return 'feed';
}

/**
 * Whether focus last moved by keyboard: a pointer press (which focuses what it
 * presses) says no, a Tab says yes. Feed it every pointerdown and keydown.
 */
export function createFocusTracker() {
  let keyboard = false;
  return {
    onPointerDown: () => {
      keyboard = false;
    },
    onKeyDown: (key: string) => {
      if (key === 'Tab') keyboard = true;
    },
    get keyboardFocus() {
      return keyboard;
    },
  };
}
