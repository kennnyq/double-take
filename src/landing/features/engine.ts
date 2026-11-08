import { createContext, useContext, useEffect, useRef } from 'react';
import type { DemoMedia } from './demo';
import type { FeatureValues } from './designs';
import type { SectionId } from './timeline';

/** The stage's geometry, in stage px; the phone's screen is `sw`×`sh` with its top left at (`sx`, `sy`). */
export interface Dims {
  W: number;
  H: number;
  narrow: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Free width beside the phone, px (left, right). */
  roomL: number;
  roomR: number;
  /** Which side cards come out to: 1 right, -1 left, 0 alternating. */
  popSide: 1 | -1 | 0;
  /** How far they come out: 0 (stay on screen) … 1.6. */
  pop: number;
  /** Where cards land vertically on the rail (its panels' lower half), screen px; none elsewhere. */
  railY: number | null;
}

/** One frame of a section: its own progress (unclamped), how much it's on screen, the stage. */
export interface SceneFrame {
  p: number;
  presence: number;
  dims: Dims;
  /** Time since the last frame, ms. */
  dt: number;
}

/** A section's frame: writes its styles; may return how far (deg) to turn the phone. */
export type SceneApply = (f: SceneFrame) => number | void;

export interface SceneHost {
  register(id: SectionId, apply: SceneApply): () => void;
  dims: Dims | null;
  media: DemoMedia | null;
  values: FeatureValues;
  /** Re-run the frame (e.g. once a scene has measured itself). */
  invalidate(): void;
}

export const SceneContext = createContext<SceneHost | null>(null);

export function useHost(): SceneHost {
  const host = useContext(SceneContext);
  if (!host) throw new Error('A features scene outside <Features>');
  return host;
}

/** Registers a section's frame function; the latest one is always called. */
export function useScene(id: SectionId, apply: SceneApply) {
  const host = useHost();
  const latest = useRef(apply);
  useEffect(() => {
    latest.current = apply;
  });
  useEffect(() => host.register(id, (f) => latest.current(f)), [host, id]);
}

const painted = new WeakMap<HTMLElement, string>();

/**
 * Writes an element's transform and opacity, only when they changed (the
 * only properties a frame touches: the compositor moves them without layout
 * or paint).
 */
export function paint(el: HTMLElement | SVGElement | null | undefined, transform: string, opacity = 1) {
  if (!el) return;
  const o = opacity <= 0.001 ? 0 : opacity >= 0.999 ? 1 : Math.round(opacity * 1000) / 1000;
  const key = `${transform}|${o}`;
  const h = el as HTMLElement;
  if (painted.get(h) === key) return;
  painted.set(h, key);
  h.style.transform = transform;
  h.style.opacity = String(o);
}

/** Pixels, rounded to a tenth (keeps style strings short and comparable). */
export const px = (n: number) => `${Math.round(n * 10) / 10}px`;
