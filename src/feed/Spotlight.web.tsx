import { useRef } from 'react';
import { useAnimatedReaction } from 'react-native-reanimated';
import { featherLayers, grow, holeFor, holePath, spotlightStrength } from './spotlight';
import { currentHole, useSpotlightMotion } from './spotlightMotion';
import type { SpotlightProps } from './Spotlight';

/** Layers stacked across a soft edge. */
const DIM_LAYERS = 6;
const BLUR_LAYERS = 3;

/**
 * The double take's spotlight in browsers: full-stage layers clipped to "stage
 * minus hole" (`clip-path: path(evenodd, …)`), so every shape is exact. Dim
 * layers are translucent black (stacked across the soft edge, see
 * `featherLayers`); blur layers use `backdrop-filter`. The hole springs
 * between areas and opens out when there is none, written straight to the
 * DOM each frame.
 */
export function Spotlight(p: SpotlightProps) {
  const m = useSpotlightMotion(p.area, p.shape);
  const ellipse = holeFor({ x: 0, y: 0, w: 10, h: 10 }, p.shape).ellipse;
  const { dim, blurPx } = spotlightStrength(p.strength);
  const blur = p.mode !== 'darken';
  const darken = p.mode !== 'blur';
  const dimEls = useRef<(HTMLDivElement | null)[]>([]);
  const blurEls = useRef<(HTMLDivElement | null)[]>([]);
  const { stageW, stageH } = p;

  useAnimatedReaction(
    () => ({ hole: currentHole(m, ellipse, stageW, stageH), on: m.on.value }),
    ({ hole, on }) => {
      const t = Math.min(1, Math.max(0, on));
      const layers = featherLayers(hole, dim, DIM_LAYERS);
      dimEls.current.forEach((el, k) => {
        const layer = layers[k];
        if (!el) return;
        if (!layer) {
          el.style.display = 'none';
          return;
        }
        el.style.display = 'block';
        clip(el, holePath(stageW, stageH, layer.hole));
        el.style.backgroundColor = `rgba(0,0,0,${(layer.alpha * Math.min(1, t * 1.4)).toFixed(4)})`;
      });
      blurEls.current.forEach((el, k) => {
        if (!el) return;
        const soft = hole.feather >= 1;
        if (!soft && k > 0) {
          el.style.display = 'none';
          return;
        }
        el.style.display = 'block';
        // Inner layer first; stacked, they blur about `blurPx` beyond the soft edge.
        const e = soft ? hole.feather * (k / (BLUR_LAYERS - 1) - 0.5) : 0;
        mask(el, holePath(stageW, stageH, grow(hole, e)), stageW, stageH);
        const px = (soft ? blurPx / Math.sqrt(BLUR_LAYERS) : blurPx) * t;
        const f = `blur(${px.toFixed(2)}px)`;
        el.style.backdropFilter = f;
        el.style.setProperty('-webkit-backdrop-filter', f);
      });
    },
    [m, ellipse, stageW, stageH, dim, blurPx, blur, darken],
  );

  return (
    <div style={layerStyle} aria-hidden>
      {blur &&
        Array.from({ length: BLUR_LAYERS }, (_, k) => (
          <div
            key={`b${k}`}
            ref={(el) => {
              blurEls.current[k] = el;
            }}
            style={layerStyle}
          />
        ))}
      {darken &&
        Array.from({ length: DIM_LAYERS }, (_, k) => (
          <div
            key={`d${k}`}
            ref={(el) => {
              dimEls.current[k] = el;
            }}
            style={layerStyle}
          />
        ))}
    </div>
  );
}

/**
 * Blur layers are masked (an SVG of the same path) rather than clipped: inside
 * a rounded overflow clip, like the clip's stage, Chrome ignores a clip-path
 * on backdrop-filter and blurs the hole too.
 */
function mask(el: HTMLDivElement, path: string, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}"><path fill="#fff" fill-rule="evenodd" d="${path}"/></svg>`;
  const v = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  el.style.maskImage = v;
  el.style.setProperty('-webkit-mask-image', v);
  el.style.setProperty('mask-size', '100% 100%');
  el.style.setProperty('-webkit-mask-size', '100% 100%');
  el.style.setProperty('mask-repeat', 'no-repeat');
  el.style.setProperty('-webkit-mask-repeat', 'no-repeat');
}

function clip(el: HTMLDivElement, path: string) {
  const v = `path(evenodd, '${path}')`;
  el.style.clipPath = v;
  el.style.setProperty('-webkit-clip-path', v);
}

const layerStyle = { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' } as const;
