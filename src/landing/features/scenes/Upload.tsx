import { useRef } from "react";
import { Link2, Video, X } from "lucide-react";
import { paint, px, useHost, useScene } from "../engine";
import { easeInOut, easeOut, lerp, plateau, seg } from "../timeline";
import {
  AppTabBar,
  AroundScreen,
  CANVAS_H,
  CANVAS_W,
  Canvas,
  Clip,
  OnScreen,
  useShown,
} from "./parts";

const TITLES = ["Check a video", "Preview", "Checking", "Result"];
/** Where each title and header action holds, of the section's progress. */
const PHASES = [0, 0.3, 0.42, 0.7, 2];
const ACTIONS: [string, number, number][] = [
  ["Check", 0.3, 0.42],
  ["Done", 0.7, 2],
];
/** The check's parts as the Create modal lists them, and what each found. */
const PARTS: {
  label: string;
  verdict: string;
  tone: "ai" | "quiet";
  at: number;
}[] = [
  { label: "Visuals", verdict: "Likely AI", tone: "ai", at: 0.52 },
  {
    label: "Inserted subject",
    verdict: "Not enough evidence",
    tone: "quiet",
    at: 0.58,
  },
  { label: "Audio", verdict: "Not applicable", tone: "quiet", at: 0.64 },
];
/** The square body under the header, in canvas points. */
const BODY_TOP = 106;
const BODY = CANVAS_W;

/**
 * Upload: a clip flies in from beside the phone and drops into the Create
 * card; the card grows to its preview, the check runs (a progress bar that
 * only moves forward with the page, its parts ticking off), then the result
 * comes up under the pinned video, and its moments come out of the screen.
 */
export function UploadScene() {
  const { dims, media } = useHost();
  const clip = media?.walk;
  const moments = (clip?.steps ?? []).slice(0, 3);
  const [shown, setShown] = useShown();
  const k = dims ? dims.sw / CANVAS_W : 1;

  const layer = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const titles = useRef<(HTMLElement | null)[]>([]);
  const actions = useRef<(HTMLElement | null)[]>([]);
  const pick = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLDivElement>(null);
  const mediaEl = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const spins = useRef<(HTMLElement | null)[]>([]);
  const verdicts = useRef<(HTMLElement | null)[]>([]);
  const decision = useRef<HTMLDivElement>(null);
  const momentsEl = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const chips = useRef<(HTMLElement | null)[]>([]);

  useScene("upload", ({ p, presence, dims: d }) => {
    setShown(presence);
    paint(
      layer.current,
      `scale(${(0.965 + 0.035 * presence).toFixed(4)})`,
      presence,
    );
    // Upload pressed on the tab bar: the Create sheet rises over the screen (a full-screen sheet on phones).
    paint(
      modal.current,
      `translate3d(0, ${px((1 - easeOut(seg(p, 0, 0.07))) * CANVAS_H)}, 0)`,
      1,
    );
    const side = d.popSide === -1 ? -1 : 1;

    // Header: the step's title and action, crossfading.
    titles.current.forEach((el, i) =>
      paint(
        el,
        "none",
        plateau(
          p,
          PHASES[i] - 0.02,
          PHASES[i] + 0.01,
          PHASES[i + 1] - 0.01,
          PHASES[i + 1] + 0.02,
        ) + (i === 0 && p < 0 ? 1 : 0),
      ),
    );
    actions.current.forEach((el, i) =>
      paint(
        el,
        "none",
        plateau(
          p,
          ACTIONS[i][1] - 0.02,
          ACTIONS[i][1] + 0.01,
          ACTIONS[i][2] - 0.01,
          ACTIONS[i][2] + 0.02,
        ),
      ),
    );

    // The clip flies in from beside the phone, lands on the drop area, and becomes the preview.
    const fly = easeInOut(seg(p, 0.06, 0.22));
    const hand = seg(p, 0.21, 0.27);
    const landX = (CANVAS_W / 2) * k - 66;
    const landY = (BODY_TOP + BODY / 2) * k - 117 - 6;
    const fromX = d.narrow
      ? landX + side * d.sw * 0.7
      : side > 0
        ? d.sw + Math.min(160, d.roomR * 0.5)
        : -132 - Math.min(160, d.roomL * 0.5);
    const fromY = d.sh * 0.08;
    const x = lerp(fromX, landX, fly);
    const y = lerp(fromY, landY, fly) - Math.sin(Math.PI * fly) * 60;
    const z = (1 - fly) * 140 * Math.max(0.3, d.pop);
    const landScale = (BODY * 0.48 * k) / 234;
    paint(
      file.current,
      `translate3d(${px(x)}, ${px(y)}, ${px(z)}) rotateZ(${((1 - fly) * -10 * side).toFixed(2)}deg) rotateY(${((1 - fly) * 24 * side).toFixed(2)}deg) scale(${lerp(1, landScale, fly).toFixed(4)})`,
      seg(p, 0.03, 0.08) * (1 - hand),
    );
    paint(drop.current, "none", plateau(p, 0.06, 0.16, 0.22, 0.3));
    paint(
      pick.current,
      `translate3d(0, ${px(-seg(p, 0.2, 0.3) * 16)}, 0)`,
      1 - seg(p, 0.18, 0.27),
    );

    // The preview: from the landed clip's size to the whole body.
    const grow = easeInOut(seg(p, 0.22, 0.36));
    const s0 = (BODY * 0.48) / BODY;
    const sc = lerp(s0, 1, grow);
    paint(
      mediaEl.current,
      `translate3d(${px(lerp((CANVAS_W - BODY * s0) / 2, 0, grow))}, ${px(lerp(BODY_TOP + (BODY - BODY * s0) / 2, BODY_TOP, grow) - BODY_TOP)}, 0) scale(${sc.toFixed(4)})`,
      hand,
    );

    // Checking: a bar that fills with the page, and the parts ticking off one by one.
    paint(progress.current, "none", plateau(p, 0.41, 0.44, 0.7, 0.74));
    paint(fill.current, `scaleX(${easeOut(seg(p, 0.44, 0.69)).toFixed(4)})`);
    const up = easeInOut(seg(p, 0.42, 0.5));
    const result = easeInOut(seg(p, 0.7, 0.79));
    paint(
      sheet.current,
      `translate3d(0, ${px(lerp(lerp(860, 560, up), 360, result))}, 0)`,
      1,
    );
    PARTS.forEach((part, i) => {
      const done = seg(p, part.at, part.at + 0.03);
      paint(spins.current[i], `rotate(${Math.round(p * 2400)}deg)`, 1 - done);
      paint(
        verdicts.current[i],
        `translate3d(${px((1 - done) * 6)}, 0, 0)`,
        done,
      );
    });
    paint(
      decision.current,
      `translate3d(0, ${px((1 - result) * 10)}, 0)`,
      result,
    );
    paint(
      momentsEl.current,
      `translate3d(0, ${px((1 - seg(p, 0.76, 0.84)) * 14)}, 0)`,
      seg(p, 0.76, 0.84),
    );

    // Its moments come out of the screen beside the phone, one after another, then go back.
    moments.forEach((_, i) => {
      const row = rows.current[i];
      const chip = chips.current[i];
      if (!row || !chip) return;
      const lift = easeInOut(
        plateau(p, 0.81 + 0.035 * i, 0.87 + 0.035 * i, 0.955, 0.995),
      );
      // The row's place on the screen, in phone pixels (its offset in the sheet, the sheet's place).
      const rx = 20 * k;
      const ry = (360 + 18 + (row.offsetTop || 0)) * k;
      const w = chip.offsetWidth || 220;
      const out =
        d.narrow || d.pop <= 0
          ? { x: rx, y: ry - 12, z: 50 * d.pop }
          : {
              x:
                side > 0
                  ? d.sw +
                    Math.min(40 + 30 * d.pop, Math.max(8, d.roomR - w - 20))
                  : -Math.min(40 + 30 * d.pop, Math.max(8, d.roomL - w - 20)) -
                    w,
              y: d.sh * 0.3 + i * 64,
              z: 60 * d.pop,
            };
      paint(
        chip,
        `translate3d(${px(lerp(rx, out.x, lift))}, ${px(lerp(ry, out.y, lift))}, ${px(out.z * lift + Math.sin(Math.PI * lift) * 30 * d.pop)}) rotateY(${(side * 10 * lift * Math.min(1, d.pop)).toFixed(2)}deg)`,
        Math.min(1, lift * 3) * presence,
      );
      paint(row, "none", 1 - 0.7 * Math.min(1, lift * 3));
    });
  });

  return (
    <>
      <OnScreen layerRef={layer}>
        <Canvas k={k}>
          <AppTabBar active="create" />
          <div
            className="ft-modal ft-a"
            ref={modal}
            style={{ transform: `translate3d(0, ${CANVAS_H}px, 0)` }}
          >
            <div className="ft-header">
              <span className="ft-left">
                <X size={26} />
              </span>
              {TITLES.map((t, i) => (
                <span
                  key={t}
                  className="ft-htitle ft-a"
                  style={{ opacity: i ? 0 : 1 }}
                  ref={(el) => {
                    titles.current[i] = el;
                  }}
                >
                  {t}
                </span>
              ))}
              {ACTIONS.map(([t], i) => (
                <span
                  key={t}
                  className="ft-right ft-a"
                  style={{ opacity: 0 }}
                  ref={(el) => {
                    actions.current[i] = el;
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="ft-drop ft-a" ref={drop} style={{ opacity: 0 }} />
            <div className="ft-pick ft-a" ref={pick}>
              <Video size={64} strokeWidth={1.4} />
              <p className="ft-pick-big">Choose a video</p>
              <span className="ft-pill">Select from device</span>
              <p className="ft-muted">MP4 or MOV · up to 60 seconds · 100 MB</p>
              <p className="ft-muted">or</p>
              <span className="ft-field">
                <Link2 size={18} /> Paste a video link
              </span>
            </div>
            <div className="ft-media ft-a" ref={mediaEl} style={{ opacity: 0 }}>
              <Clip
                src={shown.seen ? clip?.video : undefined}
                poster={clip?.poster}
                playing={shown.on}
              />
            </div>
            <div
              className="ft-progress ft-a"
              ref={progress}
              style={{ opacity: 0 }}
            >
              <i ref={fill} style={{ transform: "scaleX(0)" }} />
            </div>
            <div
              className="ft-sheet ft-a"
              ref={sheet}
              style={{ transform: "translate3d(0, 860px, 0)" }}
            >
              <div>
                <div
                  className="ft-decision ft-a"
                  ref={decision}
                  style={{ opacity: 0 }}
                >
                  Likely AI
                </div>
                <p className="ft-heading">What we can tell</p>
                {PARTS.map((part, i) => (
                  <div key={part.label} className="ft-row">
                    <span>{part.label}</span>
                    <span className="ft-state">
                      <i
                        className="ft-spin"
                        ref={(el) => {
                          spins.current[i] = el;
                        }}
                      />
                      <span
                        className="ft-verdict"
                        data-tone={part.tone}
                        style={{ opacity: 0 }}
                        ref={(el) => {
                          verdicts.current[i] = el;
                        }}
                      >
                        {part.verdict}
                      </span>
                    </span>
                  </div>
                ))}
                <div
                  className="ft-a"
                  ref={momentsEl}
                  style={{ opacity: 0, marginTop: 22 }}
                >
                  <p className="ft-heading">Moments</p>
                  {moments.map((m, i) => (
                    <div
                      key={i}
                      className="ft-moment"
                      ref={(el) => {
                        rows.current[i] = el;
                      }}
                    >
                      <b>{m.time}</b> {m.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Canvas>
      </OnScreen>
      <AroundScreen>
        <div className="ft-file ft-a" ref={file} style={{ opacity: 0 }}>
          <div className="ft-thumb">
            {clip?.poster && <img src={clip.poster} alt="" />}
          </div>
          <span>clip.mp4</span>
        </div>
        {moments.map((m, i) => (
          <div
            key={i}
            className="ft-mchip ft-a"
            style={{ opacity: 0 }}
            ref={(el) => {
              chips.current[i] = el;
            }}
          >
            <b>{m.time}</b> {m.label}
          </div>
        ))}
      </AroundScreen>
    </>
  );
}
