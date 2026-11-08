import { useMemo, useRef, useState } from 'react';
import { FrameContext, type FrameSize } from '@/game/frame';
import { toScore } from '@/skills/skill';
import { SkillsView } from '@/skills/SkillsView';
import { paint, px, useHost, useScene } from '../engine';
import { DEMO_CATEGORIES, demoSkillState, demoSkills } from '../mock';
import { easeInOut, lerp, plateau } from '../timeline';
import { AppTabBar, AroundScreen, CANVAS_H, CANVAS_W, Canvas, OnScreen, tabStrip } from './parts';

/** How much on screen the section is when the Skills tab first shows (and settles in, its own way). */
const SHOW_AT = 0.3;

/**
 * Skills: the Skills tab itself (`SkillsView`, drawing a player a few rounds
 * in from `mock.ts`, in the app's skill model: general 68, likely 61–74). It
 * shows the first time the section comes on screen, settling in as the tab
 * does when opened, and stays. The big number then comes out of the screen
 * beside the phone.
 */
export function SkillsScene() {
  const { dims } = useHost();
  const k = dims ? dims.sw / CANVAS_W : 1;
  const demo = useMemo(() => demoSkills(), []);
  const g = toScore(demo.general.now);
  const gBefore = toScore(demo.general.before);
  const state = useMemo(() => demoSkillState(), []);
  // The tab's own frame: the phone's screen above the tab bar, under the status bar.
  const frame = useMemo<FrameSize>(() => ({ width: CANVAS_W, height: CANVAS_H - tabStrip(), desktop: false, top: 54 }), []);
  // Shown the first time the section comes on screen (it settles in on mounting), then kept.
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);

  const layer = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);

  useScene('skills', ({ p, presence, dims: d }) => {
    paint(layer.current, `scale(${(0.965 + 0.035 * presence).toFixed(4)})`, presence);
    if (!shownRef.current && presence > SHOW_AT) {
      shownRef.current = true;
      setShown(true);
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
          <div className="ft-skillsview" style={{ height: frame.height }}>
            <FrameContext.Provider value={frame}>{shown && <SkillsView demo={{ state, categories: DEMO_CATEGORIES }} animate="showcase" />}</FrameContext.Provider>
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
