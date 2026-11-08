import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type { LandingValues } from './designs';
import { rand, Tile, useAtlasBoards, useBox, useTilePlayback } from './Tile';

type Speed = LandingValues['speed'];
const SPEED: Record<Speed, number> = { slow: 1.7, medium: 1, fast: 0.55 };
const GAP = 12;
const clamp = (min: number, v: number, max: number) => Math.max(min, Math.min(max, v));

interface Props {
  w: number;
  h: number;
  speed: number;
}

/** Rows of 9:16 tiles streaming sideways, alternating direction. */
function Rows({ w, h, speed, rows, tileH: fixedH, seed = 0 }: Props & { rows?: number; tileH?: number; seed?: number }) {
  const tileH = fixedH ?? clamp(140, h * 0.27, 260);
  const tileW = (tileH * 9) / 16;
  const count = rows ?? Math.ceil((h + GAP) / (tileH + GAP)) + 1;
  const per = Math.ceil(w / (tileW + GAP)) + 1;
  const trackW = per * (tileW + GAP);
  const top = (h - (count * (tileH + GAP) - GAP)) / 2;
  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <div
          key={row}
          className="lt-row"
          data-board=""
          style={{
            top: top + row * (tileH + GAP),
            height: tileH,
            animationDuration: `${((trackW / 26) * speed * (1 + (row % 3) * 0.18)).toFixed(1)}s`,
            animationDirection: row % 2 ? 'reverse' : 'normal',
          }}
        >
          {[0, 1].flatMap((half) =>
            Array.from({ length: per }, (_, i) => (
              <Tile
                key={`${half}-${i}`}
                clip={row * 3 + i + seed}
                style={{ width: tileW, height: tileH, marginRight: GAP }}
              />
            )),
          )}
        </div>
      ))}
    </>
  );
}

/** Columns of tiles scrolling up and down, like feeds side by side. */
function Columns({ w, h, speed }: Props) {
  const tileH = clamp(220, h * 0.44, 400);
  const tileW = (tileH * 9) / 16;
  const cols = Math.ceil((w + GAP) / (tileW + GAP)) + 1;
  const per = Math.ceil(h / (tileH + GAP)) + 1;
  const trackH = per * (tileH + GAP);
  const left = (w - (cols * (tileW + GAP) - GAP)) / 2;
  return (
    <>
      {Array.from({ length: cols }, (_, col) => (
        <div
          key={col}
          className="lt-col"
          data-board=""
          style={{
            left: left + col * (tileW + GAP),
            width: tileW,
            top: -(col % 2) * tileH * 0.5,
            animationDuration: `${((trackH / 22) * speed * (1 + (col % 3) * 0.2)).toFixed(1)}s`,
            animationDirection: col % 2 ? 'reverse' : 'normal',
          }}
        >
          {[0, 1].flatMap((half) =>
            Array.from({ length: per }, (_, i) => (
              <Tile key={`${half}-${i}`} clip={col * 5 + i} style={{ width: tileW, height: tileH, marginBottom: GAP }} />
            )),
          )}
        </div>
      ))}
    </>
  );
}

/** The rows on a plane tilted back in 3D. */
function Tilted({ w, h, speed }: Props) {
  const pw = w * 1.9;
  const ph = h * 2.1;
  return (
    <div className="lt-plane lt-tilted" data-plane="" style={{ width: pw, height: ph, left: (w - pw) / 2, top: (h - ph) / 2 }}>
      <Rows w={pw} h={ph} speed={speed} tileH={clamp(150, h * 0.26, 250)} />
    </div>
  );
}

/** A dense wall of clips, a few bigger than the rest, panning slowly. */
function Mosaic({ w, h, speed }: Props) {
  const colW = clamp(110, w / 9, 190);
  const rowH = colW * 1.3;
  const pw = w + colW * 2;
  const ph = h + rowH * 2;
  const cols = Math.ceil(pw / colW);
  const rows = Math.ceil(ph / rowH);
  const tiles = Array.from({ length: cols * rows }, (_, i) => i).filter((i) => i % 11 !== 5 && i % 11 !== 6);
  return (
    <div
      className="lt-plane lt-mosaic"
      data-plane=""
      data-board=""
      style={{
        width: pw,
        height: ph,
        left: -colW,
        top: -rowH,
        gridTemplateColumns: `repeat(${cols}, ${colW - 4}px)`,
        gridAutoRows: `${rowH - 4}px`,
        animationDuration: `${40 * speed}s`,
      }}
    >
      {tiles.map((i) => (
        <Tile key={i} clip={i * 7 + (i >> 3)} className={i % 9 === 4 ? 'lt-big' : ''} />
      ))}
    </div>
  );
}

/** A ring of clips turning around the words. */
function Orbit({ w, h, speed }: Props) {
  const n = 14;
  const tileH = clamp(170, h * 0.36, 320);
  const tileW = (tileH * 9) / 16;
  // Far enough out that neighbours don't overlap.
  const radius = Math.max((n * (tileW + 28)) / (2 * Math.PI), w * 0.42);
  return (
    <div className="lt-orbit-scene">
      <div className="lt-orbit" style={{ animationDuration: `${70 * speed}s` }}>
        {Array.from({ length: n }, (_, i) => (
          <Tile
            key={i}
            clip={i}
            className="lt-orbit-tile"
            style={{
              width: tileW,
              height: tileH,
              marginLeft: -tileW / 2,
              marginTop: -tileH / 2,
              transform: `rotateY(${(i * 360) / n}deg) translateZ(${radius}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Clips floating at different depths; the far ones out of focus. Follows the pointer a little. */
function Scatter({ w, h, speed }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      el.style.setProperty('--mx', String((e.clientX / window.innerWidth - 0.5) * 2));
      el.style.setProperty('--my', String((e.clientY / window.innerHeight - 0.5) * 2));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const ref0 = Math.max(h, 560);
  const items = Array.from({ length: 24 }, (_, i) => {
    const d = rand(i * 3 + 1);
    return { i, d, x: rand(i * 3 + 2), y: rand(i * 3 + 3) };
  }).sort((a, b) => a.d - b.d);
  return (
    <div className="lt-scatter" ref={ref}>
      {items.map(({ i, d, x, y }) => {
        const th = (0.15 + 0.24 * d) * ref0;
        const tw = (th * 9) / 16;
        return (
          <Tile
            key={i}
            clip={i}
            className="lt-float"
            style={
              {
                width: tw,
                height: th,
                left: x * (w + tw) - tw * 0.75,
                top: y * (h + th * 0.6) - th * 0.6,
                filter: d < 0.55 ? `blur(${((0.55 - d) * 12).toFixed(1)}px)` : undefined,
                opacity: 0.55 + d * 0.45,
                animationDuration: `${(7 + (1 - d) * 6) * speed}s`,
                animationDelay: `${-rand(i) * 10}s`,
                '--depth': d,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/** Clips flying toward you out of the dark. */
function Tunnel({ w, h, speed }: Props) {
  const n = 22;
  const tileH = clamp(150, h * 0.28, 260);
  const tileW = (tileH * 9) / 16;
  const dur = 14 * speed;
  return (
    <div className="lt-tunnel">
      {Array.from({ length: n }, (_, i) => {
        const a = i * 2.39996;
        const r = 0.45 + rand(i) * 0.55;
        return (
          <Tile
            key={i}
            clip={i}
            className="lt-fly"
            style={
              {
                width: tileW,
                height: tileH,
                marginLeft: -tileW / 2,
                marginTop: -tileH / 2,
                '--x': `${(Math.cos(a) * r * w * 0.42).toFixed(0)}px`,
                '--y': `${(Math.sin(a) * r * h * 0.4).toFixed(0)}px`,
                animationDuration: `${dur}s`,
                animationDelay: `${(-(i / n) * dur).toFixed(2)}s`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/** A phone in front playing the feed, over a wall of rows. */
function Phone({ w, h, speed }: Props) {
  return (
    <>
      <Rows w={w} h={h} speed={speed} seed={2} />
      <div className="lt-front">
        <div className="lt-phone" data-exit="phone">
          <div className="lt-phone-screen" data-clip-box="">
            <div className="lt-phone-feed" style={{ animationDuration: `${12 * speed}s` }}>
              {/* The first again at the end, so the loop restarts seamlessly. */}
              {[0, 1, 2, 3, 0].map((clip, i) => (
                <Tile key={i} clip={clip} hero className="lt-phone-tile" style={{ top: `${i * 100}%` }} />
              ))}
            </div>
          </div>
          <div className="lt-phone-island" />
        </div>
      </div>
    </>
  );
}

/** One big filmstrip under the words. */
function Filmstrip({ w, h, speed }: Props) {
  const tileH = clamp(180, h * 0.36, 320);
  return (
    <div className="lt-filmstrip" style={{ height: tileH }}>
      <Rows w={w} h={tileH} speed={speed * 1.4} rows={1} tileH={tileH} />
    </div>
  );
}

const GALLERIES: Record<LandingValues['gallery'], (p: Props) => React.ReactNode> = {
  marquee: Rows,
  columns: Columns,
  tilted: Tilted,
  mosaic: Mosaic,
  orbit: Orbit,
  scatter: Scatter,
  tunnel: Tunnel,
  phone: Phone,
  filmstrip: Filmstrip,
};

/** The hero's moving backdrop of clips. Drawn once per design and size. */
export const Gallery = memo(function Gallery({ design, speed }: { design: LandingValues['gallery']; speed: Speed }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useBox(ref);
  const Layout = GALLERIES[design];
  useTilePlayback(ref, `${design}:${w}x${h}`);
  useAtlasBoards(ref, `${design}:${w}x${h}`);
  return (
    <div className="lt-gallery" data-gallery={design} ref={ref}>
      {w > 0 && <Layout w={w} h={h} speed={SPEED[speed]} />}
    </div>
  );
});
