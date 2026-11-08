import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { dampedSpring } from '@/feed/reveal';
import { paint, px, useHost, useScene } from '../engine';
import { GAME_CALLS, answer, isRight } from '../mock';
import { clamp01, easeInOut, easeOut, lerp, seg } from '../timeline';
import { AroundScreen, CANVAS_H, CANVAS_W, Canvas, Clip, OnScreen, useShown } from './parts';

/** Each answer's beats, of the section's progress: the tap, the feedback, the swipe on. */
const BEATS = [
  { tap: 0.1, feedback: 0.17, swipe: 0.36 },
  { tap: 0.47, feedback: 0.54, swipe: 0.73 },
];
/** Where the taps land, in canvas points. */
const TAPS = [
  { x: 230, y: 330 },
  { x: 160, y: 420 },
];

/**
 * Game: spot the AI, no timer. A tap marks a clip as AI (the stamp springs in
 * where it landed), the answer comes back at once, the score ticks, and the
 * feed moves on; each answered clip leaves the screen for a stack beside the
 * phone. Drawn from `mock.ts` until the Game tab is merged.
 */
export function GameScene() {
  const { dims, media } = useHost();
  const [shown, setShown] = useShown();
  const [current, setCurrent] = useState(0);
  const k = dims ? dims.sw / CANVAS_W : 1;
  const pool = media?.others ?? [];
  // The round's clips: an AI one and a real one where the feed has them, then one more.
  const ai = pool.find((c) => c.verdict === 'ai') ?? pool[1];
  const real = pool.find((c) => c.verdict === 'real') ?? pool.find((c) => c !== ai && c.verdict);
  const clips = [ai, real, pool.find((c) => c !== ai && c !== real)];
  // Each answer follows what its clip really is.
  const answers = GAME_CALLS.map((call, i) => answer(clips[i]?.verdict ?? 'ai', call, clips[i]?.evidence));

  const layer = useRef<HTMLDivElement>(null);
  const slides = useRef<(HTMLDivElement | null)[]>([]);
  const rings = useRef<(HTMLElement | null)[]>([]);
  const stamps = useRef<(HTMLElement | null)[]>([]);
  const feedback = useRef<(HTMLElement | null)[]>([]);
  const digits = useRef<HTMLElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const tiles = useRef<(HTMLElement | null)[]>([]);

  useScene('game', ({ p, presence, dims: d }) => {
    setShown(presence);
    paint(layer.current, `scale(${(0.965 + 0.035 * presence).toFixed(4)})`, presence);
    const side = d.popSide === -1 ? -1 : 1;

    // The feed: one clip after another, moved on by a swipe after each answer.
    const at = BEATS.reduce((n, b) => n + easeInOut(seg(p, b.swipe, b.swipe + 0.08)), 0);
    const playing = Math.round(at);
    if (playing !== current) setCurrent(playing);
    slides.current.forEach((el, i) => paint(el, `translate3d(0, ${px((i - at) * CANVAS_H)}, 0)`, 1));
    paint(hint.current, 'none', 1 - seg(p, 0.05, 0.1) + seg(p, 0.8, 0.86));

    let score = 0;
    BEATS.forEach((b, i) => {
      const a = answers[i];
      // The tap, then the stamp springing in where it landed (the app's card spring, run by the scroll).
      const tap = seg(p, b.tap - 0.04, b.tap);
      paint(rings.current[i], `scale(${(0.5 + easeOut(tap) * 1.1).toFixed(4)})`, tap > 0 && tap < 1 ? (1 - tap) * 0.9 : 0);
      const t = Math.max(0, p - b.tap) * 9000;
      const st = p < b.tap ? 0 : 1 - dampedSpring(t, 0.55, 420);
      paint(stamps.current[i], `rotate(-10deg) scale(${lerp(1.6, 1, st).toFixed(4)})`, clamp01(st * 2.5));
      // The answer, at once: right or not, and why.
      const fb = easeOut(seg(p, b.feedback, b.feedback + 0.05));
      paint(feedback.current[i], `translate3d(0, ${px((1 - fb) * 16)}, 0)`, fb);
      if (isRight(a)) score += easeInOut(seg(p, b.feedback + 0.02, b.feedback + 0.07));

      // The answered clip leaves for the stack beside the phone.
      const tile = tiles.current[i];
      const go = easeInOut(seg(p, b.swipe - 0.02, b.swipe + 0.1));
      const sx = (CANVAS_W / 2) * k - 45;
      const sy = (CANVAS_H / 2) * k - 80;
      const out = d.narrow || d.pop <= 0
        ? { x: 14 + i * 64, y: d.sh - 190, z: 30, s: 0.6 }
        : { x: side > 0 ? d.sw + Math.min(50 + 20 * d.pop + i * 30, d.roomR - 110) : -Math.min(50 + 20 * d.pop + i * 30, d.roomL - 110) - 90, y: d.sh * 0.2 + i * 150, z: 50 * d.pop + i * 10, s: 1 };
      paint(
        tile,
        `translate3d(${px(lerp(sx, out.x, go))}, ${px(lerp(sy, out.y, go))}, ${px(out.z * go + Math.sin(Math.PI * go) * 60 * d.pop)}) rotateY(${(side * 14 * go * Math.min(1, d.pop)).toFixed(2)}deg) rotateZ(${(lerp(0, i ? 4 : -4, go) * side).toFixed(2)}deg) scale(${lerp(1.6, out.s, go).toFixed(4)})`,
        go > 0 ? Math.min(1, go * 4) * presence : 0,
      );
    });
    paint(digits.current, `translate3d(0, ${px(-score * 26)}, 0)`, 1);
  });

  return (
    <>
      <OnScreen layerRef={layer}>
        <Canvas k={k}>
          {clips.map((c, i) => (
            <div
              key={i}
              className="ft-slide ft-a"
              ref={(el) => {
                slides.current[i] = el;
              }}
            >
              <Clip src={shown.seen && Math.abs(i - current) <= 1 ? c?.video : undefined} poster={c?.poster} playing={shown.on && i === current} />
              <div className="ft-scrim" />
              {i < 2 && (
                <>
                  <i
                    className="ft-ring"
                    style={{ left: TAPS[i].x - 36, top: TAPS[i].y - 36, opacity: 0 }}
                    ref={(el) => {
                      rings.current[i] = el;
                    }}
                  />
                  <span
                    className="ft-stamp ft-a"
                    style={{ left: TAPS[i].x - 46, top: TAPS[i].y - 26, opacity: 0 }}
                    ref={(el) => {
                      stamps.current[i] = el;
                    }}
                  >
                    AI
                  </span>
                  <div
                    className="ft-answer ft-a"
                    data-right={isRight(answers[i]) ? '' : undefined}
                    style={{ opacity: 0 }}
                    ref={(el) => {
                      feedback.current[i] = el;
                    }}
                  >
                    <span className="ft-answer-mark">{isRight(answers[i]) ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}</span>
                    <span>
                      <b>{isRight(answers[i]) ? `Right, it’s ${answers[i].truth === 'ai' ? 'AI' : 'real'}` : `Not this time, it’s ${answers[i].truth === 'ai' ? 'AI' : 'real'}`}</b>
                      <small>{answers[i].why}</small>
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
          <div className="ft-gamebar">
            <span>Spot the AI</span>
            <span className="ft-score">
              <Check size={15} strokeWidth={3} />
              <span className="ft-digits">
                <i ref={digits}>
                  <b>0</b>
                  <b>1</b>
                  <b>2</b>
                </i>
              </span>
            </span>
          </div>
          <p className="ft-hint ft-a" ref={hint}>
            Tap if it’s AI · swipe on if it’s real
          </p>
        </Canvas>
      </OnScreen>
      <AroundScreen>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="ft-tile ft-a"
            data-right={isRight(answers[i]) ? '' : undefined}
            style={{ opacity: 0 }}
            ref={(el) => {
              tiles.current[i] = el;
            }}
          >
            {clips[i]?.poster && <img src={clips[i]?.poster} alt="" />}
            <span>{isRight(answers[i]) ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}</span>
          </div>
        ))}
      </AroundScreen>
    </>
  );
}
