/**
 * The reviewer's timeline: one lane per annotation run (model), each tell a
 * marker over its window, so every model's output is visible at a glance and
 * any frame is one click away. Pure, so it runs under `node --test`.
 */

/** The parts of a tell (src/annotations/format.ts) the timeline uses. */
export interface TimedTell {
  id: string;
  label: string;
  t0: number;
  t1: number;
  focusT?: number;
}

export interface Lane<T extends TimedTell = TimedTell> {
  name: string;
  tells: T[];
}

export interface Marker {
  lane: number;
  tell: number;
  /** Fractions of the clip, 0..1. */
  left: number;
  width: number;
  /** The frame a click goes to (fraction). */
  at: number;
}

/** Where a tell is best seen: its focus frame, else a beat into its window. Same as walkthrough.seekTimeFor. */
export function focusTime(t: TimedTell): number {
  const at = t.focusT ?? t.t0 + Math.min(0.3, (t.t1 - t.t0) / 2);
  return Math.max(0, Math.min(t.t1, Math.max(t.t0, at)));
}

/** Markers for every lane. A tell too short to see gets a minimum width, centred on its window. */
export function markers(lanes: Lane[], duration: number, minWidth = 0.008): Marker[] {
  if (!(duration > 0)) return [];
  const f = (s: number) => Math.min(1, Math.max(0, s / duration));
  const out: Marker[] = [];
  lanes.forEach((lane, li) =>
    lane.tells.forEach((t, ti) => {
      let left = f(t.t0);
      let width = f(t.t1) - left;
      if (width < minWidth) {
        left = Math.max(0, Math.min(1 - minWidth, left + width / 2 - minWidth / 2));
        width = minWidth;
      }
      out.push({ lane: li, tell: ti, left, width, at: f(focusTime(t)) });
    }),
  );
  return out;
}

/**
 * The next (dir 1) or previous (dir -1) tell from time `t` in walkthrough order,
 * by focus frame. `eps` keeps "the tell we're on" from counting as the next one.
 */
export function stepFrom<T extends TimedTell>(tells: T[], t: number, dir: 1 | -1, eps = 0.05): T | null {
  const sorted = [...tells].sort((a, b) => focusTime(a) - focusTime(b) || a.t0 - b.t0);
  if (dir > 0) return sorted.find((x) => focusTime(x) > t + eps) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) if (focusTime(sorted[i]) < t - eps) return sorted[i];
  return null;
}

/** A short name for an annotation run: its variant name, with the model that drafted it when known. */
export function runLabel(name: string, models: string[] | undefined): { name: string; model: string | null } {
  const m = (models ?? []).find(Boolean);
  return { name: name === 'main' ? 'shipped' : name, model: m ? m.replace(/^.*\//, '') : null };
}

/** Clock text for a time: "0:07.4". */
export function clock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

/**
 * The key a reviewer's mark on an annotation is stored under in the decisions log:
 * `<run>/<tell id>`, e.g. `nemotron-dense/fingers-merge-with-seal`. Characters the
 * log doesn't allow become `-`.
 */
export function tellRef(run: string, id: string): string {
  const clean = (s: string, n: number) => (s.replace(/[^\w.:-]/g, '-').slice(0, n) || '-');
  return `${clean(run, 60).replace(/:/g, '-')}/${clean(id, 120)}`;
}
