import { createContext, useContext, useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import type { Atlas } from './atlas';
import { atlasPlayer } from './AtlasPlayer';
import type { Tier } from './tier';

/** One feed clip as the gallery shows it. */
export interface GalleryClip {
  /** Its index in the feed: the launch opens the feed here. */
  index: number;
  /** Small silent copy to play in a tile; without one the tile shows the poster. */
  tile?: string;
  /** The full clip, which the one that stays switches to as it grows. */
  video?: string;
  poster?: string;
  /** Its cell in the gallery atlas, which then draws the tile instead of its own video. */
  cell?: number;
}

/** The feed's clips the gallery draws from, in feed order. */
export const GalleryClips = createContext<readonly GalleryClip[]>([]);

/** The gallery atlas, once loaded, if there is one. */
export const GalleryAtlas = createContext<Atlas | null>(null);

/** Gallery clip `n`, wrapping around; null until the feed has loaded. */
export function useGalleryClip(n: number): GalleryClip | null {
  const clips = useContext(GalleryClips);
  return clips.length ? clips[n % clips.length] : null;
}

/**
 * One clip in the gallery. The launch finds tiles by `data-tile`, opens the
 * feed on `data-clip`, and prefers `data-hero-tile` when it picks the one
 * that stays.
 */
export function Tile({
  clip,
  className = '',
  style,
  hero,
  twin,
}: {
  clip: number;
  className?: string;
  style?: CSSProperties;
  hero?: boolean;
  /** Its place in a strip that holds its tiles twice: both copies swipe together. */
  twin?: number;
}) {
  const c = useGalleryClip(clip);
  return (
    <div
      className={`lt-tile ${className}`}
      data-tile=""
      data-clip={c?.index ?? 0}
      data-cell={c?.cell}
      data-hero-tile={hero ? '' : undefined}
      data-twin={twin}
      style={style}
    >
      {c &&
        (c.cell === undefined ? (
          <video
            key={c.index}
            src={c.tile}
            poster={c.poster}
            muted
            loop
            playsInline
            preload="none"
            data-tile-video={c.tile ? '' : undefined}
          />
        ) : (
          // Drawn by the atlas (`useAtlasBoards`); the launch still moves this video and plays the full clip over it.
          <video key={c.index} muted loop playsInline preload="none" />
        ))}
    </div>
  );
}

/**
 * Plays the tiles on screen and pauses the rest, each starting somewhere
 * different in its clip. Stops managing them once the launch starts.
 */
export function useTilePlayback(rootRef: RefObject<HTMLElement | null>, key: string) {
  // Tiles get their videos once the feed has loaded.
  const loaded = useContext(GalleryClips).length;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const launching = () => root.closest('[data-launching]') !== null;
    const io = new IntersectionObserver(
      (entries) => {
        if (launching()) return;
        for (const { target, isIntersecting } of entries) {
          const v = target as HTMLVideoElement;
          if (isIntersecting) {
            if (!v.dataset.started) {
              v.dataset.started = '1';
              v.addEventListener(
                'loadedmetadata',
                () => {
                  if (v.duration) v.currentTime = Math.random() * v.duration * 0.9;
                },
                { once: true },
              );
            }
            v.play().catch(() => {});
          } else if (!v.paused) {
            v.pause();
          }
        }
      },
      { rootMargin: '80px' },
    );
    root.querySelectorAll<HTMLVideoElement>('video[data-tile-video]').forEach((v) => io.observe(v));
    return () => io.disconnect();
  }, [rootRef, key, loaded]);
}

/**
 * Has the gallery atlas draw the tiles under `rootRef` that have a cell: one
 * canvas per `[data-board]` strip, one inside each other tile. With `reels`,
 * each tile swipes to its next clip as its clip ends (false: clips loop).
 */
export function useAtlasBoards(rootRef: RefObject<HTMLElement | null>, key: string, reels?: boolean, tier: Tier = 'full') {
  const atlas = useContext(GalleryAtlas);
  const clips = useContext(GalleryClips);
  const loaded = clips.length;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !atlas || !loaded) return;
    const player = atlasPlayer(atlas);
    const clipOfCell = new Map(clips.flatMap((c) => (c.cell === undefined ? [] : [[c.cell, c.index] as const])));
    const unmount = player.mount(root, clipOfCell);
    if (reels !== undefined) player.setReels(reels, clipOfCell, tier);
    return () => {
      if (reels !== undefined) player.setReels(false, new Map());
      unmount();
    };
  }, [rootRef, key, atlas, loaded, clips, reels, tier]);
}

/** The element's size, kept up to date. */
export function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

/** Deterministic pseudo-random in [0, 1), so layouts are stable between loads. */
export function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
