import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { mediaUri } from '@/desktop/media';
import { useBlockHints } from '@/onboarding/store';
import { galleryPicks, parseAtlas, type Atlas } from './atlas';
import { DEFAULT_LANDING_PRESET, LANDING_PRESETS, LANDING_STORAGE_PREFIX, LANDING_TRIALS } from './designs';
import { Landing } from './Landing';
import { GalleryAtlas, GalleryClips, type GalleryClip } from './Tile';
import {
  FEATURE_PRESETS,
  FEATURE_TRIALS,
  FEATURES_PRESET_PARAM,
  FEATURES_STORAGE_PREFIX,
  GLOBAL_PRESETS,
  GLOBAL_TRIALS,
} from './features/designs';
import { DevAids } from './features/DevAids';
import { TrialAction, TrialBar } from './TrialBar';
import { DEV, useTrials } from './trials';

// Once someone has gone through the landing, a reload keeps them in the app.
const APP_HASH = '#app';
const GALLERY_SIZE = 48;

/**
 * The gallery atlas's manifest (`scripts/harvest/build_atlas.py`). Without
 * one, tiles play their own `tile` copies, or show posters.
 */
const ATLAS_URL = process.env.EXPO_PUBLIC_GALLERY_ATLAS || '/gallery-atlas/atlas.json';

async function loadAtlas(): Promise<Atlas | null> {
  try {
    const res = await fetch(ATLAS_URL);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return parseAtlas(await res.json(), ATLAS_URL);
  } catch {
    return null;
  }
}

/** The landing, the launch (app mounted beneath the landing), then the app. */
type Stage = 'landing' | 'launching' | 'app';

/**
 * Tiles are 9:16, so the gallery uses the feed's portrait clips; a landscape
 * one would be cropped to a sliver. Bundled placeholders play their own file.
 */
function toGallery(clips: readonly Clip[], atlas: Atlas | null): GalleryClip[] {
  return galleryPicks(clips, atlas, GALLERY_SIZE).map(({ index, cell }) => {
    const clip = clips[index];
    const video = mediaUri(clip.video);
    return { index, video, poster: mediaUri(clip.poster), tile: clip.tile ?? (clip.sourceId ? undefined : video), cell };
  });
}

/**
 * Web: the landing page in front of the app. Its launch mounts the app beneath,
 * opened on the clip that grew into the feed (`startAt`), then gets out of the way.
 * The app gets `showLanding` to come back here (the desktop logo).
 */
export function WithLanding({
  children,
}: {
  children(startAt: number | undefined, showLanding?: () => void): ReactNode;
}) {
  const [stage, setStage] = useState<Stage>(() => (window.location.hash === APP_HASH ? 'app' : 'landing'));
  const [startAt, setStartAt] = useState<number | undefined>();
  const [landingKey, setLandingKey] = useState(0);
  const trials = useTrials(LANDING_TRIALS, LANDING_PRESETS, LANDING_STORAGE_PREFIX, DEFAULT_LANDING_PRESET);
  // The features below the hero have their own designs (`?fdesign=`), and the page its own aids.
  const features = useTrials(FEATURE_TRIALS, FEATURE_PRESETS, FEATURES_STORAGE_PREFIX, undefined, FEATURES_PRESET_PARAM);
  const global = useTrials(GLOBAL_TRIALS, GLOBAL_PRESETS, FEATURES_STORAGE_PREFIX, undefined, 'fglobal');
  // The feed's first-run hint waits until the launch has handed over to it.
  useBlockHints(stage !== 'app');

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
  // Undefined while the manifest is on its way: tiles wait for it (it's small and
  // same-origin) rather than fetching posters the atlas would make unnecessary.
  const [atlas, setAtlas] = useState<Atlas | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadAtlas().then((a) => live && setAtlas(a));
    return () => {
      live = false;
    };
  }, []);
  const gallery = useMemo(() => (atlas === undefined ? [] : toGallery(clips, atlas)), [clips, atlas]);
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
      {stage !== 'landing' && children(startAt, showLanding)}
      {stage !== 'app' && (
        <GalleryClips.Provider value={gallery}>
          <GalleryAtlas.Provider value={atlas ?? null}>
          <Landing
            key={`${landingKey}:${trials.preset.id}`}
            values={trials.values}
            features={features.values}
            ready={ready}
            fullSrc={fullSrc}
            onLaunch={onLaunch}
            onDone={onDone}
          />
          </GalleryAtlas.Provider>
        </GalleryClips.Provider>
      )}
      {DEV && stage !== 'app' && global.values.meter === 'on' && <DevAids.Meter />}
      {DEV && stage !== 'app' && (
        <TrialBar
          tabs={[
            { id: 'hero', label: 'Hero', api: trials },
            { id: 'features', label: 'Features', api: features },
            { id: 'global', label: 'Global', api: global, extra: <DevAids.Jumps /> },
          ]}
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
