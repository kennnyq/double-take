import { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ROW_H, ROW_Y } from '@/game/hud/Hud';
import { MarkStamp } from '@/game/MarkStamp';
import { ScorePill } from '@/game/Pills';
import { POINTS } from '@/game/config';
import { heroCandidates } from '@/data/rank';
import { pointsFor } from '@/game/score';
import { paint, px, useHost, useScene } from '../engine';
import { GAME_CALLS, answer, isRight } from '../mock';
import { easeInOut, lerp, seg } from '../timeline';
import { AppTabBar, AroundScreen, CANVAS_H, CANVAS_W, Canvas, Clip, OnScreen, TapHand, paintHand, useShown } from './parts';

/** Each answer's beats, of the section's progress: the double tap that marks it (its second tap), the swipe on. */
const BEATS = [
  { mark: 0.16, swipe: 0.38 },
  { mark: 0.55, swipe: 0.76 },
];
/** How much of the section one double tap takes (the hint's loop). */
const TAP_SPAN = 0.16;
/** The hint's second tap lands this far into its loop (HintView's doubleTap spec). */
const SECOND_TAP = 0.38;
/** Where the taps land, in canvas points. */
const TAPS = [
  { x: 230, y: 360 },
  { x: 160, y: 430 },
];
/** The status bar: the round's score row sits under it (GameRound: `top + ROW_Y`). */
const TOP = 54;

/** A stamp's life: shown from its mark until the feed moves on; a new key springs it in again. */
interface StampState {
  key: number;
  on: boolean;
  leaving: boolean;
}

/**
 * Game: spot the AI, no timer. The gesture hint's hand double-taps a clip to
 * mark it AI, the game's own stamp springs in where it landed, the score pill
 * shows the answer at once (its ✓ or ✕, scored with the game's own points),
 * and the feed moves on; each answered clip leaves for a stack beside the
 * phone. The clips' answers are their real verdicts.
 */
export function GameScene() {
  const { dims, media } = useHost();
  const [shown, setShown] = useShown();
  const [current, setCurrent] = useState(0);
  const k = dims ? dims.sw / CANVAS_W : 1;
  const pool = heroCandidates(media?.others ?? [], 12);
  // The round's clips: an AI one and a real one where the feed has them, then one more.
  const ai = pool.find((x) => x.verdict === 'ai') ?? pool[1];
  const real = pool.find((x) => x.verdict === 'real') ?? pool.find((x) => x !== ai && x.verdict);
  const clips = [ai, real, pool.find((x) => x !== ai && x !== real)];
  // Each answer follows what its clip really is.
  const answers = GAME_CALLS.map((call, i) => answer(clips[i]?.verdict ?? 'ai', call, clips[i]?.evidence));
  const guesses = answers.map((a) => ({ guess: a.call, truth: a.truth }));

  const [stamps, setStamps] = useState<StampState[]>(BEATS.map(() => ({ key: 0, on: false, leaving: false })));
  const stampsRef = useRef(stamps);
  const [answered, setAnswered] = useState(0);
  const answeredRef = useRef(0);

  const layer = useRef<HTMLDivElement>(null);
  const slides = useRef<(HTMLDivElement | null)[]>([]);
  const handA = useRef<HTMLDivElement>(null);
  const handB = useRef<HTMLDivElement>(null);
  const hands = [handA, handB];
  const [showing, setShowing] = useState(false);
  const showingRef = useRef(false);
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

    // The stamps: in at each mark, eased away as the feed moves on (or as the page goes back before the mark).
    const next = stampsRef.current.map((st, i) => {
      const want = p >= BEATS[i].mark && p < BEATS[i].swipe;
      if (want && !st.on) return { key: st.key + 1, on: true, leaving: false };
      if (!want && st.on && !st.leaving) return { ...st, leaving: true };
      if (!want && st.leaving) return st;
      return st;
    });
    if (next.some((st, i) => st !== stampsRef.current[i])) {
      stampsRef.current = next;
      setStamps(next);
    }
    // How many answers are in (the score pill shows the last one's ✓ or ✕).
    const n = BEATS.filter((b) => p >= b.mark).length;
    if (n !== answeredRef.current) {
      answeredRef.current = n;
      setAnswered(n);
    }
    // The last answer's ✓ or ✕ shows from its mark until the feed moves on (the pill eases it in and out).
    const showing = n > 0 && p < BEATS[n - 1].swipe;
    if (showing !== showingRef.current) {
      showingRef.current = showing;
      setShowing(showing);
    }

    BEATS.forEach((b, i) => {
      // The hint's hand double-taps where the mark lands; its second tap is the mark.
      const u = (p - (b.mark - SECOND_TAP * TAP_SPAN)) / TAP_SPAN;
      paintHand(hands[i].current, u);

      // The answered clip leaves for the stack beside the phone.
      const tile = tiles.current[i];
      const go = easeInOut(seg(p, b.swipe - 0.02, b.swipe + 0.1));
      const sx = (CANVAS_W / 2) * k - 45;
      const sy = (CANVAS_H / 2) * k - 80;
      const out =
        d.narrow || d.pop <= 0
          ? { x: 14 + i * 64, y: d.sh - 190, z: 30, s: 0.6 }
          : {
              x: side > 0 ? d.sw + Math.min(50 + 20 * d.pop + i * 30, d.roomR - 110) : -Math.min(50 + 20 * d.pop + i * 30, d.roomL - 110) - 90,
              y: d.sh * 0.2 + i * 150,
              z: 50 * d.pop + i * 10,
              s: 1,
            };
      paint(
        tile,
        `translate3d(${px(lerp(sx, out.x, go))}, ${px(lerp(sy, out.y, go))}, ${px(out.z * go + Math.sin(Math.PI * go) * 60 * d.pop)}) rotateY(${(side * 14 * go * Math.min(1, d.pop)).toFixed(2)}deg) rotateZ(${(lerp(0, i ? 4 : -4, go) * side).toFixed(2)}deg) scale(${lerp(1.6, out.s, go).toFixed(4)})`,
        go > 0 ? Math.min(1, go * 4) * presence : 0,
      );
    });
  });

  const last = answered ? guesses[answered - 1] : null;
  const right = last ? last.guess === last.truth : false;
  // The game's own scoring (score.ts's scoreRound, from each guess's points).
  const score = Math.max(
    POINTS.floor,
    guesses.slice(0, answered).reduce((n, g) => n + pointsFor(g), 0),
  );
  return (
    <>
      <OnScreen layerRef={layer}>
        <Canvas k={k}>
          {clips.map((clip, i) => (
            <div
              key={i}
              className="ft-slide ft-a"
              ref={(el) => {
                slides.current[i] = el;
              }}
            >
              <Clip src={shown.seen && Math.abs(i - current) <= 1 ? clip?.video : undefined} poster={clip?.poster} playing={shown.on && i === current} />
              <div className="ft-scrim" />
              {i < BEATS.length && stamps[i].on && <MarkStamp key={stamps[i].key} x={TAPS[i].x} y={TAPS[i].y} leaving={stamps[i].leaving} />}
              {i < BEATS.length && <TapHand x={TAPS[i].x} y={TAPS[i].y} handRef={hands[i]} />}
            </div>
          ))}
          {/* The game's own score pill, where GameRound puts it: points, clips judged, the last answer's ✓ or ✕. */}
          <div className="ft-scorerow" style={{ top: TOP + ROW_Y, height: ROW_H }}>
            <ScorePill score={score} judged={answered} result={showing ? (right ? 'right' : 'wrong') : null} />
          </div>
          <AppTabBar active="game" />
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
            <span>
              <Ionicons name={isRight(answers[i]) ? 'checkmark' : 'close'} size={14} color={isRight(answers[i]) ? '#000' : '#fff'} />
            </span>
          </div>
        ))}
      </AroundScreen>
    </>
  );
}
