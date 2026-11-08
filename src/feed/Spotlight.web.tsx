import { useRef } from 'react';
import { useAnimatedReaction } from 'react-native-reanimated';
import { holeFor, holeMaskSvg, spotlightStrength, type Hole } from './spotlight';
import { currentHole, useSpotlightMotion } from './spotlightMotion';
import type { SpotlightProps } from './Spotlight';

/**
 * The double take's spotlight in browsers: one translucent black layer
 * (darken) and one backdrop-filter layer (blur), each masked by an SVG of the
 * stage with the hole cut out and its edge blurred across the shape's feather,
 * so every shape is exact and soft edges are smooth. The hole springs between
 * areas and opens out when there is none; the mask is rewritten only while it
 * moves.
 *
 * A mask rather than a clip-path: inside a rounded overflow clip, like the
 * clip's stage, Chrome ignores a clip-path on backdrop-filter.
 */
export function Spotlight(p: SpotlightProps) {
  const m = useSpotlightMotion(p.area, p.shape);
  const ellipse = holeFor({ x: 0, y: 0, w: 10, h: 10 }, p.shape).ellipse;
  const { dim, blurPx } = spotlightStrength(p.strength);
  const blur = p.mode !== 'darken';
  const darken = p.mode !== 'blur';
  const dimEl = useRef<HTMLDivElement>(null);
  const blurEl = useRef<HTMLDivElement>(null);
  const { stageW, stageH } = p;

  useAnimatedReaction(
    () => ({ hole: currentHole(m, ellipse, stageW, stageH), on: m.on.value }),
    ({ hole, on }) => {
      const t = Math.min(1, Math.max(0, on));
      const v = maskUrl(stageW, stageH, hole);
      const d = dimEl.current;
      if (d) {
        setMask(d, v);
        d.style.backgroundColor = `rgba(0,0,0,${(dim * Math.min(1, t * 1.4)).toFixed(4)})`;
      }
      const b = blurEl.current;
      if (b) {
        setMask(b, v);
        const f = `blur(${(blurPx * t).toFixed(2)}px)`;
        b.style.backdropFilter = f;
        b.style.setProperty('-webkit-backdrop-filter', f);
      }
    },
    [m, ellipse, stageW, stageH, dim, blurPx, blur, darken],
  );

  return (
    <div style={layerStyle} aria-hidden>
      {blur && <div ref={blurEl} style={layerStyle} />}
      {darken && <div ref={dimEl} style={layerStyle} />}
    </div>
  );
}

function maskUrl(w: number, h: number, hole: Hole): string {
  return `url("data:image/svg+xml,${encodeURIComponent(holeMaskSvg(w, h, hole))}")`;
}

function setMask(el: HTMLDivElement, url: string) {
  const s = el.style;
  if (s.maskImage === url) return;
  s.maskImage = url;
  s.setProperty('-webkit-mask-image', url);
}

const layerStyle = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
  maskSize: '100% 100%',
  WebkitMaskSize: '100% 100%',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
} as const;
