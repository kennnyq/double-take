import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Bookmark, Eye, Heart, MessageCircle, Music2, Repeat2, Send } from 'lucide-react';

/**
 * A section's screen: clipped to the phone's screen, crossfading with the
 * other sections' as the page scrolls (`layerRef` takes the fade).
 */
export function OnScreen({ children, layerRef }: { children: ReactNode; layerRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ft-layer" ref={layerRef} style={{ opacity: 0 }}>
      {children}
    </div>
  );
}

/** A section's pieces around the screen, where cards come out (3D, in the phone's space). */
export function AroundScreen({ children }: { children: ReactNode }) {
  return <div className="ft-pops">{children}</div>;
}

/** The feed's chrome over a clip: the action rail and who posted it, as in the app. */
export function FeedChrome({ author, caption, chromeRef }: { author: string; caption: string; chromeRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ft-chrome" ref={chromeRef}>
      <div className="ft-rail">
        <span>
          <Eye size={24} />
        </span>
        <span>
          <Heart size={24} />
          <small>12.4K</small>
        </span>
        <span>
          <MessageCircle size={24} />
          <small>318</small>
        </span>
        <span>
          <Repeat2 size={24} />
          <small>96</small>
        </span>
        <span>
          <Send size={22} />
          <small>1.2K</small>
        </span>
        <span>
          <Bookmark size={22} />
          <small>Save</small>
        </span>
      </div>
      <div className="ft-meta">
        <div className="ft-author">
          <i className="ft-avatar">{author.slice(0, 1).toUpperCase()}</i>
          <b>@{author}</b>
          <em>Subscribe</em>
        </div>
        <p>{caption}</p>
        <p className="ft-audio">
          <Music2 size={11} /> Original audio
        </p>
      </div>
    </div>
  );
}

/**
 * A muted, inline clip that plays only while `playing` (and has its source
 * only once `src` is given: nothing loads before the section is near).
 */
export function Clip({
  src,
  poster,
  playing,
  videoRef,
  loop = true,
  className,
}: {
  src?: string;
  poster?: string;
  playing: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  loop?: boolean;
  className?: string;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [playing, src, ref]);
  return (
    <video
      ref={ref}
      className={className ?? 'ft-video'}
      src={src}
      poster={poster}
      muted
      playsInline
      loop={loop}
      preload={src ? 'auto' : 'none'}
      disablePictureInPicture
    />
  );
}
