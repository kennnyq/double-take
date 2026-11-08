import { useMemo, useRef, useState } from 'react';
import { SkillBars } from '@/skills/SkillBars';
import { toScore } from '@/skills/skill';
import { paint, px, useHost, useScene } from '../engine';
import { DEMO_CATEGORIES, demoSkills } from '../mock';
import { easeInOut, lerp, plateau } from '../timeline';
import { AppTabBar, AroundScreen, CANVAS_W, Canvas, OnScreen } from './parts';

/** Where in the section the round's change plays (the bars and the score move from before to now). */
const PLAY_AT = 0.1;

/**
 * Skills: the Skills tab's own score and bars (`SkillBars`, the app's
 * component), for a player a few rounds in (`mock.ts`, in the app's skill
 * model). As the section arrives, the last round's change plays: the score
 * counts up and each bar moves from its old value to its new one, the app's
 * own easing, once (it then stays). The big
 * number then comes out of the screen beside the phone.
 */
export function SkillsScene() {
  const { dims } = useHost();
  const k = dims ? dims.sw / CANVAS_W : 1;
  const demo = useMemo(() => demoSkills(), []);
  const g = toScore(demo.general.now);
  const gBefore = toScore(demo.general.before);
  // The first time the section reaches PLAY_AT, the bars play their change (a new mount: SkillBars animates on mount),
  // from the old values they were showing, and then stay at the new ones (scrolling back never snaps them back).
  const [played, setPlayed] = useState(false);
  const playedRef = useRef(false);

  const layer = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);

  useScene('skills', ({ p, presence, dims: d }) => {
    paint(layer.current, `scale(${(0.965 + 0.035 * presence).toFixed(4)})`, presence);
    if (!playedRef.current && p >= PLAY_AT && presence > 0.5) {
      playedRef.current = true;
      setPlayed(true);
    }

    // The big number comes out of the screen beside the phone, and goes back.
    const s = d.popSide === -1 ? -1 : 1;
    const lift = easeInOut(plateau(p, 0.48, 0.62, 0.88, 0.98));
    const from = { x: 20 * k, y: 180 * k };
    const bw = big.current?.offsetWidth ?? 200;
    const out =
      d.narrow || d.pop <= 0
        ? { x: from.x, y: from.y - 14, z: 60 * d.pop, s: 1 }
        : {
            x: s > 0 ? d.sw + Math.min(40 + 40 * d.pop, Math.max(8, d.roomR - bw - 24)) : -Math.min(40 + 40 * d.pop, Math.max(8, d.roomL - bw - 24)) - bw,
            y: d.sh * 0.18,
            z: 80 * d.pop,
            s: 1.05,
          };
    paint(
      big.current,
      `translate3d(${px(lerp(from.x, out.x, lift))}, ${px(lerp(from.y, out.y, lift))}, ${px(out.z * lift + Math.sin(Math.PI * lift) * 40 * d.pop)}) rotateY(${(s * 12 * lift * Math.min(1, d.pop)).toFixed(2)}deg) scale(${lerp(0.9, out.s, lift).toFixed(4)})`,
      Math.min(1, lift * 3) * presence,
    );
  });

  return (
    <>
      <OnScreen layerRef={layer}>
        <Canvas k={k}>
          <div className="ft-skills">
            <p className="ft-h1">Your skills</p>
            <div className="ft-skillbars">
              {played ? (
                <SkillBars key="played" skills={demo.now} before={demo.before} categories={DEMO_CATEGORIES} general={demo.general} delay={120} />
              ) : (
                <SkillBars key="before" skills={demo.before} categories={DEMO_CATEGORIES} general={{ now: demo.general.before }} />
              )}
            </div>
            <p className="ft-note-sk">50 is guessing. The faint band is how sure the score is; it narrows with every answer.</p>
          </div>
          <AppTabBar active="skills" />
        </Canvas>
      </OnScreen>
      <AroundScreen>
        <div className="ft-bigscore ft-a" ref={big} style={{ opacity: 0 }}>
          <b>{g.score}</b>
          <small>
            General · likely {g.low}–{g.high} · ▲ {g.score - gBefore.score}
          </small>
        </div>
      </AroundScreen>
    </>
  );
}
