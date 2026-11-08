/**
 * The timed round's designs on trial: each element of the round has a few
 * ways to look and move, picked independently in the game lab
 * (`/dev/game-lab`) or Dev settings → Game. Production builds play the
 * defaults. Pure, for `node --test`.
 */

export const GAME_ELEMENTS = ['countdown', 'hud', 'reveal', 'grid', 'expand'] as const;
export type GameElement = (typeof GAME_ELEMENTS)[number];

export interface DesignOption {
  id: string;
  label: string;
  /** One line on what it does. */
  note: string;
}

export interface ElementInfo {
  label: string;
  options: readonly DesignOption[];
  /** The pick production builds use. */
  default: string;
  /** Why the default. */
  why: string;
}

export const GAME_DESIGNS = {
  countdown: {
    label: 'Countdown',
    options: [
      { id: 'ring', label: 'Ring', note: 'A ring sweeps round once while the numbers crossfade; then it shrinks into the timer.' },
      { id: 'resolve', label: 'Resolve', note: 'Each number resolves from faint and blurred to sharp, like the double take’s text, then flies into the timer.' },
      { id: 'roll', label: 'Roll', note: 'A pill rolls 3-2-1 like an odometer while it fills, then shrinks into the timer.' },
    ],
    default: 'resolve',
    why: 'It speaks the same visual language as the double take’s text reveal, and the last number becomes the clock, so the morph reads as one object.',
  },
  hud: {
    label: 'Timer',
    options: [
      { id: 'bar', label: 'Bar', note: 'A thin bar across the top that drains, with the time beside it.' },
      { id: 'pill', label: 'Pill', note: 'A pill at the top centre that drains behind the time.' },
      { id: 'ring', label: 'Ring', note: 'A small ring in the corner that drains round, the seconds inside.' },
    ],
    default: 'pill',
    why: 'One compact object the countdown can land in; it stays out of the clip’s middle and leaves the corners to the buttons.',
  },
  reveal: {
    label: 'Results reveal',
    options: [
      { id: 'settle', label: 'Settle', note: 'Tiles rise and settle in round order, then their glow eases in.' },
      { id: 'flip', label: 'Flip', note: 'Tiles start face down and flip over one by one.' },
      { id: 'sweep', label: 'Sweep', note: 'All tiles show dimmed, then a light sweeps across, lighting each up.' },
    ],
    default: 'flip',
    why: 'Turning cards over is the most fun reveal and gives each answer its own beat while the score counts up.',
  },
  grid: {
    label: 'Results tiles',
    options: [
      { id: 'glow', label: 'Glow', note: 'A soft green or red glow, a ✓ or ✕, and an AI or Real chip.' },
      { id: 'ring', label: 'Ring', note: 'A green or red outline with a ✓ or ✕ badge, and an AI or Real chip.' },
      { id: 'strip', label: 'Strip', note: 'A green or red band along the bottom holding the ✓ or ✕ and AI or Real.' },
    ],
    default: 'glow',
    why: 'The glow reads at a glance without covering the poster; the ✓/✕ and the chip carry the same facts without colour.',
  },
  expand: {
    label: 'Open a clip',
    options: [
      { id: 'morph', label: 'Morph', note: 'The tile grows into the full clip and shrinks back into its place.' },
      { id: 'lift', label: 'Lift', note: 'The tile lifts first, then springs open to the full clip.' },
      { id: 'zoom', label: 'Zoom', note: 'The page dims and the clip zooms up out of the tile as it fades in.' },
    ],
    default: 'morph',
    why: 'A true shared-element move: the clip never leaves the tile you tapped, so opening and closing feel like one gesture.',
  },
} as const satisfies Record<GameElement, ElementInfo>;

export type DesignId<E extends GameElement> = (typeof GAME_DESIGNS)[E]['options'][number]['id'];
export type GameDesigns = { [E in GameElement]: DesignId<E> };

export const DEFAULT_DESIGNS: GameDesigns = Object.freeze(
  Object.fromEntries(GAME_ELEMENTS.map((e) => [e, GAME_DESIGNS[e].default])) as GameDesigns,
);

export function isDesign<E extends GameElement>(element: E, value: unknown): value is DesignId<E> {
  return GAME_DESIGNS[element].options.some((o) => o.id === value);
}

/** Designs from stored values; anything unknown takes its default. */
export function parseDesigns(raw: unknown): GameDesigns {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_DESIGNS } as Record<GameElement, string>;
  for (const e of GAME_ELEMENTS) if (isDesign(e, o[e])) out[e] = o[e] as string;
  return out as GameDesigns;
}

/** The design `dir` steps from the current one, wrapping round. */
export function stepDesign<E extends GameElement>(element: E, current: string, dir: 1 | -1): DesignId<E> {
  const ids = GAME_DESIGNS[element].options.map((o) => o.id);
  const i = Math.max(0, ids.indexOf(current as never));
  return ids[(i + dir + ids.length) % ids.length] as DesignId<E>;
}
