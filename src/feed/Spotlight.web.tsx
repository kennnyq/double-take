import { useEffect, useRef } from 'react';
import { useAnimatedReaction } from 'react-native-reanimated';
import { Asset } from 'expo-asset';
import type { VideoPlayer } from 'expo-video';
import { maskFor, maskPlacement, spotlightStrength, type MaskName } from './spotlight';
import type { SpotlightProps } from './Spotlight';
import { videoRect } from './tells';

const SPOT_IMAGES: Record<MaskName, number> = {
  rect: require('../../assets/spotlight/spot-rect.png'),
  rounded: require('../../assets/spotlight/spot-rounded.png'),
  ellipse: require('../../assets/spotlight/spot-ellipse.png'),
  soft: require('../../assets/spotlight/spot-soft.png'),
  blob: require('../../assets/spotlight/spot-blob.png'),
};

/** Width of the still the cheap blur draws (it's blurred anyway). */
const STILL_W = 180;

/**
 * The double take's spotlight in browsers. Each layer covers the stage and is
 * masked by "everything but the spot" (a prepared soft-edged image, excluded
 * from a full mask), so every shape is exact and its edge is smooth. Moving
 * the hole only changes the mask's position and size each frame: nothing is
 * re-rendered or re-rasterized from scratch.
 *
 *  - darken: one translucent black layer;
 *  - cheapBlur: plus a blurred still of the loop under it, drawn once per step
 *    into a small canvas (a CSS blur on a static image is cheap; WebKit's
 *    backdrop-filter over a playing video is not);
 *  - fullBlur: plus a backdrop-filter layer (smooth in Chrome, slow in Safari).
 */
export function Spotlight(p: SpotlightProps) {
  const { motion: m, stageW, stageH, effect } = p;
  const { dim, blurPx, stillBlur } = spotlightStrength(p.strength, effect === 'cheapBlur' || effect === 'fullBlur');
  const dimEl = useRef<HTMLDivElement>(null);
  const blurEl = useRef<HTMLDivElement>(null);
  const stillEl = useRef<HTMLCanvasElement>(null);
  const spot = Asset.fromModule(SPOT_IMAGES[maskFor(p.shape)]).uri;

  // The mask image, set once per shape; frames only move it.
  useEffect(() => {
    for (const el of [dimEl.current, blurEl.current, stillEl.current]) {
      if (!el) continue;
      const v = `url("${spot}"), linear-gradient(#000, #000)`;
      el.style.maskImage = v;
      el.style.setProperty('-webkit-mask-image', v);
    }
  }, [spot, effect]);

  // The cheap blur's still: the frame the loop starts on, drawn once per step.
  useEffect(() => {
    const canvas = stillEl.current;
    const video = videoElementOf(p.player);
    if (!canvas || !video || p.stillAt == null || !video.videoWidth) return;
    const frame = videoRect(STILL_W, (STILL_W * stageH) / stageW, video.videoWidth / video.videoHeight, 'contain');
    canvas.width = STILL_W;
    canvas.height = Math.round((STILL_W * stageH) / stageW);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      ctx.drawImage(video, frame.x, frame.y, frame.w, frame.h);
    } catch {
      // Not drawable yet: the step shows darken only.
    }
  }, [p.player, p.stillAt, stageW, stageH, effect]);

  useAnimatedReaction(
    () => ({ x: m.x.value, y: m.y.value, w: m.w.value, h: m.h.value, on: m.on.value }),
    (v) => {
      const t = Math.min(1, Math.max(0, v.on));
      const r = maskPlacement(v);
      const pos = `${r.x.toFixed(1)}px ${r.y.toFixed(1)}px, 0 0`;
      const size = `${r.w.toFixed(1)}px ${r.h.toFixed(1)}px, 100% 100%`;
      for (const el of [dimEl.current, blurEl.current, stillEl.current]) {
        if (!el) continue;
        el.style.maskPosition = pos;
        el.style.setProperty('-webkit-mask-position', pos);
        el.style.maskSize = size;
        el.style.setProperty('-webkit-mask-size', size);
      }
      if (dimEl.current) dimEl.current.style.opacity = (dim * Math.min(1, t * 1.3)).toFixed(3);
      if (stillEl.current) stillEl.current.style.opacity = t.toFixed(3);
      if (blurEl.current) {
        const f = `blur(${(blurPx * t).toFixed(2)}px)`;
        blurEl.current.style.backdropFilter = f;
        blurEl.current.style.setProperty('-webkit-backdrop-filter', f);
      }
    },
    [m, dim, blurPx, effect],
  );

  if (effect === 'off') return null;
  return (
    <div style={layer} aria-hidden>
      {effect === 'cheapBlur' && <canvas ref={stillEl} style={{ ...layer, ...masked, width: '100%', height: '100%', filter: `blur(${stillBlur}px)`, opacity: 0 }} />}
      {effect === 'fullBlur' && <div ref={blurEl} style={{ ...layer, ...masked }} />}
      <div ref={dimEl} data-testid="dt-spot-dim" style={{ ...layer, ...masked, background: '#000', opacity: 0 }} />
    </div>
  );
}

/** The <video> behind a player: expo-video's web player, or the desktop's HtmlVideoPlayer. */
function videoElementOf(player: VideoPlayer | null | undefined): HTMLVideoElement | null {
  const p = player as unknown as { _mountedVideos?: Set<HTMLVideoElement>; element?: HTMLVideoElement | null } | null;
  if (!p) return null;
  if (p.element) return p.element;
  return p._mountedVideos ? ([...p._mountedVideos][0] ?? null) : null;
}

const layer = { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', willChange: 'opacity' } as const;
/** Spot excluded from a full mask: everything but the spot shows. */
const masked = {
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
  maskComposite: 'exclude',
  WebkitMaskComposite: 'xor',
} as const;
