import { useRef } from 'react';
import { paint, px, useHost, useScene } from '../engine';
import { SKILLS } from '../mock';
import { easeInOut, easeOut, lerp, plateau, seg, wheels } from '../timeline';
import { AroundScreen, CANVAS_W, Canvas, OnScreen } from './parts';

const DIGITS = Array.from({ length: 11 }, (_, i) => i % 10);
const ROW_H = 64;

/**
 * Skills: the general score counts up from where it was to where it is (on
 * odometer wheels, never jumping), its range and change come in, each
 * category's bar fills from its old score to its new one as the page
 * scrolls, and the big number comes out of the screen. Drawn from `mock.ts`
 * until the Skills tab is merged.
 */
export function SkillsScene() {
  const { dims } = useHost();
  const k = dims ? dims.sw / CANVAS_W : 1;
  const g = SKILLS.general;

  const layer = useRef<HTMLDivElement>(null);
  const tens = useRef<HTMLElement>(null);
  const ones = useRef<HTMLElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const fills = useRef<(HTMLElement | null)[]>([]);
  const vals = useRef<(HTMLElement | null)[]>([]);
  const deltas = useRef<(HTMLElement | null)[]>([]);
  const bands = useRef<(HTMLElement | null)[]>([]);
  const big = useRef<HTMLDivElement>(null);
  const bigNum = useRef<HTMLElement>(null);

  useScene('skills', ({ p, presence, dims: d }) => {
    paint(layer.current, `scale(${(0.965 + 0.035 * presence).toFixed(4)})`, presence);
    const count = easeInOut(seg(p, 0.08, 0.42));
    const w = wheels(lerp(g.before, g.score, count));
    paint(tens.current, `translate3d(0, ${px(-w.tens * ROW_H)}, 0)`);
    paint(ones.current, `translate3d(0, ${px(-w.ones * ROW_H)}, 0)`);
    paint(side.current, `translate3d(${px((1 - seg(p, 0.36, 0.46)) * -8)}, 0, 0)`, seg(p, 0.36, 0.46));

    SKILLS.rows.forEach((r, i) => {
      const t = easeOut(seg(p, 0.14 + 0.06 * i, 0.38 + 0.06 * i));
      const v = lerp(r.before, r.score, t);
      paint(fills.current[i], `scaleX(${(v / 100).toFixed(4)})`);
      paint(bands.current[i], 'none', seg(p, 0.3 + 0.06 * i, 0.4 + 0.06 * i) * 0.8);
      const el = vals.current[i];
      // The number follows the bar; a whole number at a time is how the app shows it too.
      const shownV = String(Math.round(v));
      if (el && el.textContent !== shownV) el.textContent = shownV;
      paint(deltas.current[i], `translate3d(${px((1 - seg(p, 0.36 + 0.06 * i, 0.44 + 0.06 * i)) * -6)}, 0, 0)`, seg(p, 0.36 + 0.06 * i, 0.44 + 0.06 * i));
    });

    // The big number comes out of the screen beside the phone, and goes back.
    const s = d.popSide === -1 ? -1 : 1;
    const lift = easeInOut(plateau(p, 0.48, 0.62, 0.88, 0.98));
    const from = { x: 20 * k, y: 180 * k };
    const bw = big.current?.offsetWidth ?? 200;
    const out = d.narrow || d.pop <= 0
      ? { x: from.x, y: from.y - 14, z: 60 * d.pop, s: 1 }
      : { x: s > 0 ? d.sw + Math.min(40 + 40 * d.pop, Math.max(8, d.roomR - bw - 24)) : -Math.min(40 + 40 * d.pop, Math.max(8, d.roomL - bw - 24)) - bw, y: d.sh * 0.18, z: 80 * d.pop, s: 1.05 };
    paint(
      big.current,
      `translate3d(${px(lerp(from.x, out.x, lift))}, ${px(lerp(from.y, out.y, lift))}, ${px(out.z * lift + Math.sin(Math.PI * lift) * 40 * d.pop)}) rotateY(${(s * 12 * lift * Math.min(1, d.pop)).toFixed(2)}deg) scale(${lerp(0.9, out.s, lift).toFixed(4)})`,
      Math.min(1, lift * 3) * presence,
    );
    if (bigNum.current) {
      const n = String(Math.round(lerp(g.before, g.score, count)));
      if (bigNum.current.textContent !== n) bigNum.current.textContent = n;
    }
  });

  return (
    <>
      <OnScreen layerRef={layer}>
        <Canvas k={k}>
          <div className="ft-skills">
            <p className="ft-h1">Skills</p>
            <div className="ft-general">
              <span className="ft-odo" aria-label={`General score ${g.score}`}>
                <span ref={tens}>
                  {DIGITS.map((n, i) => (
                    <b key={i}>{n}</b>
                  ))}
                </span>
                <span ref={ones}>
                  {DIGITS.map((n, i) => (
                    <b key={i}>{n}</b>
                  ))}
                </span>
              </span>
              <div className="ft-gside ft-a" ref={side} style={{ opacity: 0 }}>
                <span>▲ {g.score - g.before}</span>
                <span>
                  {g.low}–{g.high}
                </span>
              </div>
            </div>
            {SKILLS.rows.map((r, i) => (
              <div key={r.label} className="ft-srow">
                <span>{r.label}</span>
                <span className="ft-track">
                  <i
                    className="ft-band"
                    style={{ left: `${r.low}%`, width: `${r.high - r.low}%`, opacity: 0 }}
                    ref={(el) => {
                      bands.current[i] = el;
                    }}
                  />
                  <i
                    className="ft-fill"
                    style={{ transform: `scaleX(${r.before / 100})` }}
                    ref={(el) => {
                      fills.current[i] = el;
                    }}
                  />
                  <i className="ft-mid" />
                </span>
                <span
                  className="ft-sval"
                  ref={(el) => {
                    vals.current[i] = el;
                  }}
                >
                  {r.before}
                </span>
                <span
                  className="ft-delta ft-a"
                  style={{ opacity: 0 }}
                  ref={(el) => {
                    deltas.current[i] = el;
                  }}
                >
                  {r.score !== r.before ? `▲ ${r.score - r.before}` : ''}
                </span>
              </div>
            ))}
            <p className="ft-note-sk">50 is guessing. The faint band is how sure the score is; it narrows with every answer.</p>
          </div>
        </Canvas>
      </OnScreen>
      <AroundScreen>
        <div className="ft-bigscore ft-a" ref={big} style={{ opacity: 0 }}>
          <b ref={bigNum}>{g.before}</b>
          <small>
            General · {g.low}–{g.high} · ▲ {g.score - g.before}
          </small>
        </div>
      </AroundScreen>
    </>
  );
}
