/** CSS easings as functions, and reshaping one mid-flight so it never speeds up. */

const KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

/** A cubic-bezier's output at input `x` (0..1). */
function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  // x(t) is increasing on [0, 1] (x1, x2 in [0, 1]): bisect for it.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

/** A CSS easing (a keyword or `cubic-bezier()`) as a function of progress; null for any other form. */
export function easingCurve(css: string): ((x: number) => number) | null {
  const key = KEYWORDS[css.trim()];
  const m = key ? null : /^cubic-bezier\(([^)]*)\)$/.exec(css.trim());
  const p = key ?? m?.[1].split(',').map(Number);
  if (!p || p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [x1, y1, x2, y2] = p;
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : bezier(x1, y1, x2, y2, x));
}

/**
 * The easing `css` reshaped at progress `p` so that from there on it never
 * goes faster than it is going at `p`: as it was up to `p`, then slowing
 * steadily from that speed to a stop at the end. As a CSS `linear()` easing,
 * or null when the easing never speeds up after `p` anyway (or isn't one
 * `easingCurve` reads).
 */
export function neverFaster(css: string, p: number, steps = 24): string | null {
  const f = easingCurve(css);
  if (!f || p >= 1) return null;
  const h = 1e-3;
  const slope = (x: number) => (f(Math.min(1, x + h)) - f(Math.max(0, x - h))) / (Math.min(1, x + h) - Math.max(0, x - h));
  const s = slope(p);
  let faster = false;
  for (let i = 1; i <= 40 && !faster; i++) faster = slope(p + ((1 - p) * i) / 40) > s * 1.01 + 1e-3;
  if (!faster) return null;
  const y0 = f(p);
  const rest = 1 - p;
  const after = (x: number) => y0 + s * (x - p) - (s * (x - p) ** 2) / (2 * rest);
  const points: string[] = [];
  const add = (y: number, x: number) => points.push(`${+y.toFixed(5)} ${+(x * 100).toFixed(4)}%`);
  const before = Math.max(1, Math.round(steps * p));
  for (let i = 0; i <= before; i++) add(f((p * i) / before), (p * i) / before);
  for (let i = 1; i <= steps; i++) add(after(p + (rest * i) / steps), p + (rest * i) / steps);
  return `linear(${points.join(', ')})`;
}
