import { createContext, useContext, useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** One feed clip as the gallery shows it. */
export interface GalleryClip {
  /** Its index in the feed: the launch opens the feed here. */
  index: number;
  /** Small silent copy to play in a tile; without one the tile shows the poster. */
  tile?: string;
  /** The full clip, which the one that stays switches to as it grows. */
  video?: string;
  poster?: string;
}

/** The feed's clips the gallery draws from, in feed order. */
export const GalleryClips = createContext<readonly GalleryClip[]>([]);

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
}: {
  clip: number;
  className?: string;
  style?: CSSProperties;
  hero?: boolean;
}) {
  const c = useGalleryClip(clip);
  return (
    <div
      className={`lt-tile ${className}`}
      data-tile=""
      data-clip={c?.index ?? 0}
      data-hero-tile={hero ? '' : undefined}
      style={style}
    >
      {c && (
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
      )}
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
