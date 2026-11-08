import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';
import {
  BadgeCheck,
  Bookmark,
  ChevronDown,
  CircleCheck,
  ChevronUp,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Play,
  Repeat2,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { REPLAY_RATE } from '@/annotations/walkthrough';
import { avatarHue, formatCount, makeClips, type Clip, type Verdict } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { useDevSettings } from '@/devtools/store';
import { autoLabel, clipsForMode, isAppend, keepPosition, modeFilter, shownIndexOf, VERDICT_TEXT } from '@/feed/feedMode';
import { TellOverlay, type TellOverlayHandle } from '@/feed/TellOverlay';
import { FeedEmpty, VerdictBadge } from '@/feed/VerdictBadge';
import { receiveHandoff } from '@/landing/handoff';
import { fitFor, type Fit } from '@/feed/tells';
import { useSocialActions } from '@/social/actions';
import { baseReposts, clipKey } from '@/social/clipRefs';
import type { ClipCounts } from '@/social/reducer';
import { useAppNav } from '@/social/nav';
import { gestureAction, isDoubleTap, spaceWaitsForHold, type Tap } from '@/settings/gesture';
import { useAppSettings } from '@/settings/store';
import type { RevealGesture } from '@/settings/settings';
import { useSocial } from '@/social/store';
import { useToast } from '@/ui/Toast';
import { HtmlVideoPlayer } from './HtmlVideoPlayer';
import { mediaUri } from './media';
import { useFeedScroller } from './useFeedScroller';

/** Pooled `<video>` elements: the active clip and one neighbour on each side. */
const POOL = 3;
/** Clips kept loaded ahead of the active one (placeholders extend the feed endlessly). */
const AHEAD = 12;
/** The card fills the feed's height minus this margin (see `.stage.card` in desktop.css). */
const CARD_MARGIN = 32;

export interface DesktopFeedHandle {
  /** Land on an item index instantly, loading more clips first if needed. */
  jumpTo: (index: number) => void;
}

interface Props {
  /** The Home tab is showing: play the active clip and listen for wheel and keys. */
  visible: boolean;
  /** False while something else (a sheet) owns the wheel and keyboard. */
  scrollEnabled: boolean;
  ref?: React.Ref<DesktopFeedHandle>;
}

/**
 * Reels-style desktop feed: a centred 9:16 card with the author beside it and
 * an action column, moved one clip at a time by wheel, trackpad, keyboard or
 * the up/down buttons (`useFeedScroller`).
 *
 * Every clip has a slide with its poster and overlays; three pooled `<video>`
 * elements are layered over the active slide and its neighbours and recycled
 * as you move, so the next clip is already buffered. The active card hosts the
 * same "Reveal AI tells" walkthrough as the app, through `HtmlVideoPlayer`.
 */
export function DesktopFeed({ visible, scrollEnabled, ref }: Props) {
  // Remote clips then placeholders, as loaded; more placeholders follow on demand.
  const [base, setBase] = useState<Clip[] | null>(null);
  const [minCount, setMinCount] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const [feedH, setFeedH] = useState(0);

  // The feed mode (Settings) may keep only AI or only real clips; that feed ends
  // (placeholders have no verdict). Otherwise the feed is endless once loaded:
  // the list below always reaches AHEAD past the active clip.
  const { feedMode, revealGesture } = useAppSettings();
  const { holdMs } = useDevSettings();
  // The active clip's walkthrough (only the active slide mounts one), for Space and the slides' gestures.
  const reveal = useRef<TellOverlayHandle>(null);
  const filter = modeFilter(feedMode);
  const filtered = useMemo(() => (base && filter ? clipsForMode(base, feedMode) : null), [base, filter, feedMode]);
  const { active, goTo, next, prev } = useFeedScroller(
    feedRef,
    filtered ? filtered.length : base ? Number.MAX_SAFE_INTEGER : 0,
    visible && scrollEnabled,
  );

  const total = base ? Math.max(base.length, active + AHEAD, minCount) : 0;
  const endless = useMemo(
    () => (base ? [...base, ...makeClips(base.length, Math.max(0, total - base.length))] : []),
    [base, total],
  );
  const clips = filtered ?? endless;

  useEffect(() => {
    let live = true;
    loadInitialClips().then((c) => live && setBase(c));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFeedH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- playback state -----------------------------------------------------
  // Browsers only autoplay muted; the card's sound button unmutes inside a click.
  const [muted, setMuted] = useState(true);
  // The landing's launch hands over its sound once this feed's video has taken
  // over from the clip that grew into it.
  useEffect(() => receiveHandoff((h) => setMuted(h.muted)), []);
  // Remembering which clip was paused means moving on always plays the next one.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const paused = pausedAt === active;
  // Set by the tells walkthrough while it is open on the active clip.
  const [inspecting, setInspecting] = useState(false);
  const [slowmo, setSlowmo] = useState(false);

  // ---- video pool ---------------------------------------------------------
  // Slot = index % POOL, so an element keeps its clip while it stays in the
  // window and is recycled for the item entering on the other side.
  const start = Math.max(0, Math.min(active - 1, clips.length - POOL));
  const slotIndex = useMemo(() => {
    const s = Array<number>(POOL).fill(-1);
    for (let i = start; i < Math.min(start + POOL, clips.length); i++) s[i % POOL] = i;
    return s;
  }, [start, clips.length]);

  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const spinners = useRef<(HTMLDivElement | null)[]>([]);
  const [players] = useState(() => Array.from({ length: POOL }, () => new HtmlVideoPlayer()));
  // Latest values for event handlers, so the handlers (and the memoized slides) stay stable.
  const activeRef = useRef(active);
  const slotIndexRef = useRef(slotIndex);
  const mutedRef = useRef(muted);
  useEffect(() => {
    activeRef.current = active;
    slotIndexRef.current = slotIndex;
    mutedRef.current = muted;
  }, [active, slotIndex, muted]);

  const safePlay = useCallback((v: HTMLVideoElement) => {
    v.play().catch((err: DOMException) => {
      // Autoplay with sound refused (no user gesture yet): fall back to muted.
      if (err?.name === 'NotAllowedError' && !v.muted) {
        setMuted(true);
        v.muted = true;
        v.play().catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    slotIndex.forEach((idx, s) => {
      const v = videos.current[s];
      if (!v) return;
      if (idx === active && visible) {
        v.muted = muted || slowmo;
        v.playbackRate = slowmo ? REPLAY_RATE : 1;
        if (paused) v.pause();
        else if (v.paused) safePlay(v);
      } else {
        v.pause();
        v.muted = true;
        v.playbackRate = 1;
      }
    });
    // Rewind items we left, once they are off screen, so revisits start over.
    const t = window.setTimeout(() => {
      slotIndexRef.current.forEach((idx, s) => {
        const v = videos.current[s];
        if (v && idx !== activeRef.current && v.currentTime > 0) v.currentTime = 0;
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [active, paused, muted, slowmo, visible, slotIndex, safePlay]);

  // Buffering spinner on the active card, after a short grace period.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let waitingSince = 0;
    const loop = (now: number) => {
      const s = slotIndexRef.current.indexOf(activeRef.current);
      const v = s >= 0 ? videos.current[s] : null;
      const stalled = !!v && !v.paused && v.readyState < 3;
      if (stalled && !waitingSince) waitingSince = now;
      if (!stalled) waitingSince = 0;
      spinners.current.forEach((sp, i) => {
        sp?.classList.toggle('on', i === s && !!waitingSince && now - waitingSince > 350);
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const togglePause = useCallback(() => {
    const i = activeRef.current;
    setPausedAt((p) => (p === i ? null : i));
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    setMuted(nextMuted);
    if (nextMuted) return;
    // Unmute and play inside the click, so the browser counts it as a user gesture.
    const s = slotIndexRef.current.indexOf(activeRef.current);
    const v = s >= 0 ? videos.current[s] : null;
    if (v) {
      // eslint-disable-next-line react-hooks/immutability -- a DOM <video>, not React state.
      v.muted = false;
      safePlay(v);
    }
  }, [safePlay]);

  // Space = play/pause, or held = the double take; M = mute (arrows, Page keys and
  // J/K live in the scroller). When holding Space opens the active clip's double
  // take, a quick press plays/pauses on release, so a hold never pauses first;
  // otherwise Space plays/pauses on press, as always.
  const space = useRef({ down: false, waiting: false, held: false, timer: 0 });
  useEffect(() => {
    if (!visible || !scrollEnabled) return;
    const sp = space.current;
    const reset = () => {
      window.clearTimeout(sp.timer);
      sp.down = sp.waiting = sp.held = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      if (t?.closest?.('[aria-modal="true"]')) return;
      if (e.key === ' ') {
        e.preventDefault(); // never scroll the page, repeats included
        if (e.repeat || sp.down) return;
        sp.down = true;
        if (spaceWaitsForHold(revealGesture, !!reveal.current)) {
          sp.waiting = true;
          sp.timer = window.setTimeout(() => {
            sp.held = true;
            reveal.current?.open();
          }, holdMs);
        } else {
          togglePause();
        }
      } else if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        toggleMute();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !sp.down) return;
      e.preventDefault();
      const tap = sp.waiting && !sp.held;
      reset();
      if (tap) togglePause();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
    };
  }, [visible, scrollEnabled, togglePause, toggleMute, revealGesture, holdMs]);

  // ---- feed mode switch ------------------------------------------------------
  // Stay on the same clip, or the nearest one after it.
  const shownBefore = useRef(clips);
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = clips;
    if (isAppend(before, clips)) return;
    setPausedAt(null);
    goTo(keepPosition(before, clips, activeRef.current), true);
  }, [clips, goTo]);

  // ---- jump to a clip (profile tile) ---------------------------------------
  // Grow the list if needed, then land once the feed is showing and long enough.
  // A filtered feed lands on that clip, or the next one it shows.
  const pendingJump = useRef<number | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      jumpTo: (i: number) => {
        pendingJump.current = i;
        setMinCount((n) => Math.max(n, i + POOL + 1));
      },
    }),
    [],
  );
  useEffect(() => {
    const i = pendingJump.current;
    if (i === null || !visible || !base || (!filtered && i >= clips.length)) return;
    pendingJump.current = null;
    goTo(filtered ? shownIndexOf(filtered, i) : i, true);
  }, [visible, base, filtered, clips.length, minCount, goTo]);

  // ---- interactions -------------------------------------------------------
  const social = useSocial();
  const actions = useSocialActions();
  const nav = useAppNav();
  const toast = useToast();
  const liked = useMemo(() => new Set(social.liked.map((e) => e.id)), [social.liked]);
  const saved = useMemo(() => new Set(social.saved.map((e) => e.id)), [social.saved]);
  const reposted = useMemo(() => new Set(social.reposted.map((e) => e.id)), [social.reposted]);
  const sent = useMemo(() => new Set(social.sent.map((e) => e.id)), [social.sent]);
  const followed = useMemo(() => new Set(social.followed), [social.followed]);

  const handlers = useMemo<SlideHandlers>(
    () => ({
      togglePause,
      play: () => setPausedAt(null),
      pause: () => setPausedAt(activeRef.current),
      like: actions.like,
      toggleLike: actions.toggleLike,
      toggleSave: actions.toggleSave,
      toggleRepost: actions.toggleRepost,
      toggleFollow: actions.toggleFollow,
      openComments: (clip) => nav.openSheet('comments', clip),
      openShare: (clip) => nav.openSheet('share', clip),
      toggleMute,
      setSlowmo,
      setInspecting,
      reveal,
      revealGesture,
      holdMs,
      soon: (what) => toast.show({ icon: 'time-outline', text: `${what} coming soon` }),
    }),
    [togglePause, actions, nav, toggleMute, toast, revealGesture, holdMs],
  );

  const cardH = Math.max(0, feedH - CARD_MARGIN);
  // Stable between renders, so moving to another clip re-renders only the slides that change.
  const card = useMemo(() => ({ w: Math.round((cardH * 9) / 16), h: cardH }), [cardH]);
  const fitOf = (i: number): Fit => (i === active && inspecting ? 'contain' : fitFor(clips[i]?.aspect));

  return (
    <div className="feed-wrap desktop">
      <div className="feed" ref={feedRef} tabIndex={-1} aria-label="Video feed">
        {clips.map((clip, i) => (
          <Slide
            key={clip.id}
            clip={clip}
            isActive={i === active}
            paused={i === active && paused}
            muted={muted}
            liked={liked.has(clipKey(clip))}
            saved={saved.has(clipKey(clip))}
            reposted={reposted.has(clipKey(clip))}
            sent={sent.has(clipKey(clip))}
            followed={followed.has(clip.author)}
            myComments={social.comments[clipKey(clip)]?.length ?? 0}
            others={social.stats[clipKey(clip)]}
            label={autoLabel(clip, feedMode)}
            inspecting={i === active && inspecting}
            fit={fitOf(i)}
            card={card}
            player={i === active && slotIndex.indexOf(i) >= 0 ? players[slotIndex.indexOf(i)] : null}
            h={handlers}
          />
        ))}

        {slotIndex.map((idx, s) => (
          <div key={s} className="pool-slot" style={{ ['--i' as string]: Math.max(idx, 0) }} hidden={idx < 0}>
            <div className="slide-grid">
              <div className="stage">
                <video
                  ref={(el) => {
                    videos.current[s] = el;
                    players[s].attach(el);
                  }}
                  src={idx >= 0 ? mediaUri(clips[idx].video) : undefined}
                  style={{ objectFit: idx >= 0 ? fitOf(idx) : 'cover' }}
                  preload="auto"
                  playsInline
                  loop
                  muted
                  disablePictureInPicture
                />
                <div
                  className="spinner"
                  ref={(el) => {
                    spinners.current[s] = el;
                  }}
                />
              </div>
            </div>
          </div>
        ))}
        {filter && filtered?.length === 0 && (
          <div className="feed-empty">
            <FeedEmpty verdict={filter} />
          </div>
        )}
      </div>

      <div className="d-nav">
        <button className="round-btn" onClick={prev} disabled={active === 0} aria-label="Previous video">
          <ChevronUp size={26} />
        </button>
        <button
          className="round-btn"
          onClick={next}
          disabled={!!filtered && active >= filtered.length - 1}
          aria-label="Next video"
        >
          <ChevronDown size={26} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SlideHandlers {
  togglePause: () => void;
  play: () => void;
  pause: () => void;
  /** Returns false when it didn't run (a guest is asked to sign in). */
  like: (clip: Clip) => boolean;
  toggleLike: (clip: Clip) => void;
  toggleSave: (clip: Clip) => void;
  toggleRepost: (clip: Clip) => void;
  toggleFollow: (author: string) => void;
  openComments: (clip: Clip) => void;
  openShare: (clip: Clip) => void;
  toggleMute: () => void;
  setSlowmo: (on: boolean) => void;
  setInspecting: (on: boolean) => void;
  /** The active clip's walkthrough. */
  reveal: React.RefObject<TellOverlayHandle | null>;
  revealGesture: RevealGesture;
  holdMs: number;
  soon: (what: string) => void;
}

interface SlideProps {
  clip: Clip;
  isActive: boolean;
  paused: boolean;
  muted: boolean;
  liked: boolean;
  saved: boolean;
  reposted: boolean;
  sent: boolean;
  followed: boolean;
  myComments: number;
  /** Other members' likes, reposts and comments (on top of the clip's own counts). */
  others?: ClipCounts;
  /** The verdict shown without a reveal (Auto label mode), or null. */
  label: Verdict | null;
  inspecting: boolean;
  fit: Fit;
  card: { w: number; h: number };
  /** The active clip's pooled player, once it holds this clip. */
  player: HtmlVideoPlayer | null;
  h: SlideHandlers;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  r: number;
}

const DOUBLE_TAP_MS = 300;

const Slide = memo(function Slide(p: SlideProps) {
  const { clip, isActive, h } = p;
  const [bursts, setBursts] = useState<Burst[]>([]);
  const gesture = useRef({ x: 0, y: 0, moved: false, held: false, timer: 0, last: null as Tap | null });
  const { reveal: tells, revealGesture, holdMs } = h;
  const hasTells = !!clip.tellsUrl && isActive;
  const poster = mediaUri(clip.poster);

  const cancelHold = () => window.clearTimeout(gesture.current.timer);
  useEffect(() => cancelHold, []);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const g = gesture.current;
    g.x = e.clientX;
    g.y = e.clientY;
    g.moved = false;
    g.held = false;
    cancelHold();
    // Click and hold counts as a hold too, like holding Space (desktop has no 2x hold).
    if (isActive && gestureAction('hold', revealGesture, { hasTells, canBoost: false }) === 'reveal') {
      g.timer = window.setTimeout(() => {
        g.held = true;
        g.last = null;
        tells.current?.open();
      }, holdMs);
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) {
      g.moved = true;
      cancelHold();
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    cancelHold();
    const g = gesture.current;
    // The hold already did its thing; the release is not also a click.
    if (g.held || g.moved || !isActive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tap = { t: performance.now(), x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (isDoubleTap(g.last, tap, DOUBLE_TAP_MS)) {
      g.last = null;
      // Double click: like with a heart burst, or the double take. Always resume
      // (never toggle), so the first click's pause can't leave the clip paused.
      h.play();
      if (gestureAction('doubleTap', revealGesture, { hasTells, canBoost: false }) === 'reveal') {
        tells.current?.open();
        return;
      }
      // A guest's like opens sign-in instead: no heart.
      if (!h.like(clip)) return;
      const b = { id: tap.t, x: tap.x, y: tap.y, r: Math.round(Math.random() * 30 - 15) };
      setBursts((bs) => [...bs, b]);
      window.setTimeout(() => setBursts((bs) => bs.filter((o) => o.id !== b.id)), 900);
      return;
    }
    g.last = tap;
    h.togglePause();
  };

  const info = (
    <div className="d-info-inner">
      {p.label && (
        <span className={`d-verdict ${p.label}`} aria-label={p.label === 'ai' ? 'Verdict: AI-generated' : 'Verdict: not AI'}>
          {p.label === 'ai' ? <Sparkles size={13} fill="currentColor" /> : <CircleCheck size={13} />}
          {VERDICT_TEXT[p.label]}
        </span>
      )}
      <div className="d-author">
        <span className="avatar" style={{ width: 32, height: 32, ['--hue' as string]: avatarHue(clip.author) }}>
          {clip.author[0]?.toUpperCase()}
        </span>
        <span className="name">{clip.author}</span>
        {clip.verified && <BadgeCheck className="verified" size={16} fill="#3797f0" color="#000" />}
        <span className="dot">•</span>
        <button className={`follow ${p.followed ? 'on' : ''}`} onClick={() => h.toggleFollow(clip.author)}>
          {p.followed ? 'Following' : 'Follow'}
        </button>
      </div>
      <div className="d-audio">
        <Music2 size={13} />
        <span>
          {clip.author} · {clip.audio}
        </span>
      </div>
      <p className="d-caption">{clip.caption}</p>
    </div>
  );

  const likes = formatCount(clip.likes + (p.others?.likes ?? 0) + (p.liked ? 1 : 0));
  const comments = formatCount(clip.comments + (p.others?.comments ?? 0) + p.myComments);
  const reposts = formatCount(baseReposts(clip) + (p.others?.reposts ?? 0) + (p.reposted ? 1 : 0));
  const shares = formatCount(clip.shares + (p.sent ? 1 : 0));

  return (
    <section className="slide" aria-roledescription="video" aria-current={isActive}>
      <div className="slide-grid">
        <aside className="d-info">{info}</aside>
        <div className="stage card">
          {p.fit === 'contain' ? (
            <>
              <img className="poster blurred" src={poster} alt="" draggable={false} />
              <img className="poster contained" src={poster} alt="" draggable={false} />
            </>
          ) : (
            <img className="poster" src={poster} alt="" draggable={false} />
          )}
          <div className="overlay">
            {!p.inspecting && <div className="shade compact-only" />}
            <div
              className="tap-layer"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelHold}
              onPointerLeave={cancelHold}
              onContextMenu={(e) => hasTells && e.preventDefault()}
            >
              {p.paused && !p.inspecting && (
                <div className="paused-icon" aria-hidden>
                  <Play size={40} fill="currentColor" />
                </div>
              )}
              {bursts.map((b) => (
                <Heart
                  key={b.id}
                  className="burst"
                  size={96}
                  fill="currentColor"
                  style={{ left: b.x, top: b.y, ['--r' as string]: `${b.r}deg` }}
                />
              ))}
            </div>
            {!p.inspecting && <div className="d-info-overlay compact-only">{info}</div>}
            {isActive && clip.tellsUrl && p.card.h > 0 && (
              <TellOverlay
                ref={tells}
                variants={clip.tellsVariants ?? [{ name: 'main', url: clip.tellsUrl }]}
                player={p.player?.asVideoPlayer() ?? null}
                stageW={p.card.w}
                stageH={p.card.h}
                aspect={clip.aspect ?? 9 / 16}
                fit={p.fit}
                top={12}
                paused={p.paused}
                onPause={h.pause}
                onPlay={h.play}
                onSlowmo={h.setSlowmo}
                onInspect={h.setInspecting}
              />
            )}
            {/* The reveal shows the verdict along with the reasoning, in every feed mode. */}
            {p.inspecting && clip.verdict && (
              <div className="reveal-verdict">
                <VerdictBadge verdict={clip.verdict} />
              </div>
            )}
            {isActive && !p.inspecting && (
              <button className="mute-btn" onClick={h.toggleMute} aria-label={p.muted ? 'Unmute' : 'Mute'}>
                {p.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            )}
          </div>
        </div>
        <div className="d-actions">
          <ActionBtn
            label={likes}
            onClick={() => h.toggleLike(clip)}
            className={p.liked ? 'liked' : ''}
            name={p.liked ? 'Unlike' : 'Like'}
            pressed={p.liked}
          >
            <Heart size={26} fill={p.liked ? 'currentColor' : 'none'} />
          </ActionBtn>
          <ActionBtn label={comments} onClick={() => h.openComments(clip)} name="Comments">
            <MessageCircle size={26} style={{ transform: 'scaleX(-1)' }} />
          </ActionBtn>
          <ActionBtn
            label={reposts}
            onClick={() => h.toggleRepost(clip)}
            name={p.reposted ? 'Undo repost' : 'Repost'}
            className={p.reposted ? 'reposted' : ''}
            pressed={p.reposted}
          >
            <Repeat2 size={26} />
          </ActionBtn>
          <ActionBtn label={shares} onClick={() => h.openShare(clip)} name="Share">
            <Send size={24} />
          </ActionBtn>
          <ActionBtn
            onClick={() => h.toggleSave(clip)}
            name={p.saved ? 'Remove from saved' : 'Save'}
            className={p.saved ? 'saved' : ''}
            pressed={p.saved}
          >
            <Bookmark size={26} fill={p.saved ? 'currentColor' : 'none'} />
          </ActionBtn>
          <ActionBtn onClick={() => h.soon('More options')} name="More">
            <MoreHorizontal size={24} />
          </ActionBtn>
          <img className="sound-thumb" src={poster} alt="" />
        </div>
      </div>
    </section>
  );
});

function ActionBtn(props: {
  label?: string;
  name: string;
  onClick: () => void;
  className?: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`action-btn ${props.className ?? ''}`}
      onClick={props.onClick}
      aria-label={props.label ? `${props.name} (${props.label})` : props.name}
      aria-pressed={props.pressed}
    >
      {props.children}
      {props.label && <span>{props.label}</span>}
    </button>
  );
}
