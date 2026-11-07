import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { mediaUri } from '@/desktop/media';
import { LANDING_PRESETS, LANDING_STORAGE_PREFIX, LANDING_TRIALS } from './designs';
import { Landing } from './Landing';
import { GalleryClips, type GalleryClip } from './Tile';
import { TrialAction, TrialBar } from './TrialBar';
import { DEV, useTrials } from './trials';

// Once someone has gone through the landing, a reload keeps them in the app.
const APP_HASH = '#app';
const GALLERY_SIZE = 24;

/** The landing, the launch (app mounted beneath the landing), then the app. */
type Stage = 'landing' | 'launching' | 'app';

/**
 * Tiles are 9:16, so the gallery uses the feed's portrait clips; a landscape
 * one would be cropped to a sliver. Bundled placeholders play their own file.
 */
function toGallery(clips: readonly Clip[]): GalleryClip[] {
  return clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => (clip.aspect ?? 9 / 16) < 1)
    .slice(0, GALLERY_SIZE)
    .map(({ clip, index }) => {
      const video = mediaUri(clip.video);
      return { index, video, poster: mediaUri(clip.poster), tile: clip.tile ?? (clip.sourceId ? undefined : video) };
    });
}

/**
 * Web: the landing page in front of the app. Its launch mounts the app beneath,
 * opened on the clip that grew into the feed (`startAt`), then gets out of the way.
 */
export function WithLanding({ children }: { children(startAt: number | undefined): ReactNode }) {
  const [stage, setStage] = useState<Stage>(() => (window.location.hash === APP_HASH ? 'app' : 'landing'));
  const [startAt, setStartAt] = useState<number | undefined>();
  const [landingKey, setLandingKey] = useState(0);
  const trials = useTrials(LANDING_TRIALS, LANDING_PRESETS, LANDING_STORAGE_PREFIX);

  // The same request the feed makes (shared), so the gallery and the feed agree on indices.
  const [ready] = useState(() => loadInitialClips());
  const [clips, setClips] = useState<readonly Clip[]>([]);
  const clipsRef = useRef<readonly Clip[]>([]);
  useEffect(() => {
    let live = true;
    void ready.then((c) => {
      clipsRef.current = c;
      if (live) setClips(c);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  const gallery = useMemo(() => toGallery(clips), [clips]);
  const fullSrc = useCallback((i: number) => {
    const c = clipsRef.current[i];
    return c ? mediaUri(c.video) : undefined;
  }, []);

  const showLanding = useCallback(() => {
    setLandingKey((k) => k + 1);
    setStage('landing');
    setStartAt(undefined);
  }, []);

  // Back from the app returns to the landing.
  useEffect(() => {
    const onPop = () => {
      if (window.location.hash !== APP_HASH) showLanding();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showLanding]);

  // Showing the landing again (Replay) takes `#app` off the address, so a reload shows it too.
  useEffect(() => {
    if (stage !== 'landing' || window.location.hash !== APP_HASH) return;
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(window.history.state, '', url);
  }, [stage]);

  // Development: picking another design shows it from the start.
  const designKey = JSON.stringify(trials.values);
  const [shownKey, setShownKey] = useState(designKey);
  if (designKey !== shownKey) {
    setShownKey(designKey);
    showLanding();
  }

  const onLaunch = useCallback((clip: number) => {
    setStartAt(clip);
    setStage('launching');
  }, []);
  const onDone = useCallback(() => {
    setStage('app');
    window.history.pushState(window.history.state, '', APP_HASH);
  }, []);

  return (
    <>
      {stage !== 'landing' && children(startAt)}
      {stage !== 'app' && (
        <GalleryClips.Provider value={gallery}>
          <Landing
            key={`${landingKey}:${trials.preset.id}`}
            values={trials.values}
            ready={ready}
            fullSrc={fullSrc}
            onLaunch={onLaunch}
            onDone={onDone}
          />
        </GalleryClips.Provider>
      )}
      {DEV && (
        <TrialBar
          api={trials}
          actions={
            <TrialAction label="Replay the landing" onClick={showLanding}>
              <RotateCcw size={18} />
            </TrialAction>
          }
        />
      )}
    </>
  );
}
