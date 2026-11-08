import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { easedSeek, safeSeek, setScrubMode } from '@/feed/scrub';
import { fracAt, pressIntent, timeLabel } from '@/feed/seek';
import type { HtmlVideoPlayer } from './HtmlVideoPlayer';

interface Props {
  /** The active clip's player; null for other slides (the bar shows empty). */
  player: HtmlVideoPlayer | null;
  /** Out of reach, though still shown as it is (during a double take: the walkthrough owns the clicks). */
  inert: boolean;
  /** Hold the clip paused and silent while scrubbing. */
  onHold: (on: boolean) => void;
}

/** Seeking is a property write on the player; kept out of the component body. */
function seekTo(player: HtmlVideoPlayer, seconds: number) {
  safeSeek(player, seconds);
}

/** Seeks while dragging, at most this often (ms). */
const DRAG_SEEK_MS = 40;

/**
 * The desktop clip's progress bar: a slim line along the bottom of the card
 * that thickens under the pointer, with the time under the pointer in a
 * bubble. Drag along it and the video follows; click and it fast-forwards or
 * rewinds there (an eased scrub, never a jump). The fill follows playback
 * every frame. Arrow keys seek too (see DesktopFeed).
 */
export function DeskScrubber({ player, inert, onHold }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const bubbleInset = useRef(0);
  const g = useRef({ x0: 0, y0: 0, mode: 'idle' as 'idle' | 'pending' | 'drag', lastSeek: 0, cancel: () => {} });

  // The fill follows playback (and the eased scrub) every frame; a drag sets it directly.
  useEffect(() => {
    if (!player) {
      if (fill.current) fill.current.style.transform = 'scaleX(0)';
      return;
    }
    let raf = 0;
    const loop = () => {
      const d = player.duration;
      if (fill.current && g.current.mode !== 'drag') fill.current.style.transform = `scaleX(${d ? Math.min(1, player.currentTime / d) : 0})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);
  useEffect(() => () => g.current.cancel(), []);

  // Positions along the track, which runs between the card's rounded corners (--card-radius).
  const xOf = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(e.currentTarget).getPropertyValue('--card-radius')) || 0;
    // The bubble is placed in the strip, so it gets the inset back.
    bubbleInset.current = inset;
    return { x: e.clientX - r.left - inset, w: r.width - 2 * inset };
  };
  const showTime = (x: number, w: number) => {
    const d = player?.duration ?? 0;
    const b = bubble.current;
    if (!b || !d) return;
    b.textContent = timeLabel(fracAt(x, w) * d, d);
    b.style.left = `${bubbleInset.current + Math.min(w - 44, Math.max(44, x))}px`;
  };
  const dragTo = (x: number, w: number, force = false) => {
    const d = player?.duration ?? 0;
    if (!player || !d) return;
    const f = fracAt(x, w);
    if (fill.current) fill.current.style.transform = `scaleX(${f})`;
    showTime(x, w);
    const now = performance.now();
    if (force || now - g.current.lastSeek >= DRAG_SEEK_MS) {
      g.current.lastSeek = now;
      seekTo(player, f * d);
    }
  };

  return (
    <div
      ref={root}
      className={`d-scrub ${inert ? 'inert' : ''} ${dragging ? 'dragging' : ''}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-hidden={inert || !player}
      onPointerDown={(e) => {
        if (e.button !== 0 || !player) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        g.current.x0 = e.clientX;
        g.current.y0 = e.clientY;
        g.current.mode = 'pending';
      }}
      onPointerMove={(e) => {
        const { x, w } = xOf(e);
        const s = g.current;
        if (s.mode === 'pending' && pressIntent(e.clientX - s.x0, e.clientY - s.y0, 4) === 'drag' && player) {
          s.mode = 'drag';
          s.cancel();
          setDragging(true);
          onHold(true);
          setScrubMode(player, true);
        }
        if (s.mode === 'drag') dragTo(x, w);
        else showTime(x, w);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const { x, w } = xOf(e);
        const s = g.current;
        if (s.mode === 'drag' && player) {
          dragTo(x, w, true);
          setScrubMode(player, false);
          setDragging(false);
          onHold(false);
        } else if (s.mode === 'pending' && player && player.duration) {
          s.cancel();
          s.cancel = easedSeek(player, fracAt(x, w) * player.duration, onHold);
        }
        s.mode = 'idle';
      }}
      onPointerCancel={() => {
        const s = g.current;
        if (s.mode === 'drag' && player) {
          setScrubMode(player, false);
          setDragging(false);
          onHold(false);
        }
        s.mode = 'idle';
      }}
    >
      <div className="d-scrub-track">
        <div className="d-scrub-fill" ref={fill} />
      </div>
      <div className="d-scrub-bubble" ref={bubble} />
    </div>
  );
}
