import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { uploadId } from '../investigation/upload-id';
import { acceptUpload, sendOrRecover, uploadRoute } from '../investigation/upload-flow';
import { getJob, mediaUrl, retryAnalysis, upload, uploadLink, type ClientJob } from '../investigation/client';
import { uuid } from '../lib/uuid';
import type { InvestigationSummary } from '../investigation/contract';
import { canUpload, requireMember } from '../auth/gate';
import { useAuth } from '../auth/store';
import { ownLayer } from '../feed/layer';
import { usePalette } from '../ui/theme';
import { EvidencePlayer, type EvidencePlayerHandle } from '../components/investigation/EvidencePlayer';
import { HowWeChecked, LiveTrace, rowsOf, stepLinks, type StepLink } from './Trace';
import { Processing } from '../components/investigation/Processing';
import { DropZone } from './DropZone';
import { ClipPreview, previewSource } from './ClipPreview';
import { lookupDemoCheckStatus, type DemoLookup, type DemoQuery } from '@/demo/lookup';
import { hashAsset, preparedJob } from './demo';
import { EASE_IN_OUT, EASE_OUT, useEased, useLatched, usePresence } from './motion';
import { Assessments, Button, FileNotes, WouldHelp, VerdictHeadline, ErrorNote, HeaderAction, IconButton, Reveal, StepLayer, Swap, useTint } from './parts';

/*
 * Create → check a video, laid out like a post composer: one card (a
 * full-screen sheet on phones) with a single header — back on the left, the
 * step's title in the middle, the next action on the right — and a square
 * body that steps through
 *
 *   0 pick     drop or select a video, or paste a link
 *   1 preview  the clip (or link) with "Check" in the header
 *   2 check    progress, then the result and its walkthrough
 *
 * On desktop the card widens to the right for the result, the way a composer
 * opens its side panel. Every error shows inside the card, at the step that
 * failed, with the way to retry right under it.
 */

/** A prepared (cloud) check, ready to show. */
type Prepared = NonNullable<ReturnType<typeof preparedJob>>;

type Selection =
  | {
      kind: 'file';
      asset: DocumentPicker.DocumentPickerAsset;
      preview: { uri: string; release: () => void };
      /** The file's SHA-256, worked out in the background from the moment it's picked (null if it couldn't be read). */
      sha256: Promise<string | null>;
    }
  | { kind: 'link'; url: string };
type Request = { id: string; send: () => Promise<ClientJob> };

const HEADER = 52;
/** Desktop: the result's side panel, and the gap kept around the card. */
const PANEL = 340;
const MARGIN = 48;
/** Desktop: the pick step's card, before a clip or link gives it something to show. */
const COMPACT = 440;
/** Desktop: the card's corner radius, rounder while it's the compact pick card. */
const RADIUS = 14;
const RADIUS_COMPACT = 24;
/** Desktop: the header's corner caps; wider than any radius the card takes. */
const CAP = 30;
const MAX_UPLOAD = 100 * 1024 * 1024;
const SIGN_IN_REASON = 'Sign in to check a video';

function normalizeLink(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function pickProblem(asset: DocumentPicker.DocumentPickerAsset): string | undefined {
  if ((asset.size ?? 0) > MAX_UPLOAD) return 'Choose a video under 100 MB.';
  const type = asset.mimeType ?? '';
  const named = /\.(mp4|m4v|mov)$/i.test(asset.name ?? '');
  if (!named && type && !/^video\/(mp4|quicktime|x-m4v)$/.test(type)) return 'Choose an MP4 or MOV video.';
  return undefined;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function UploadModal({ open, onClose, onOpen }: { open: boolean; onClose: () => void; /** Opens Create again (after signing in). */ onOpen?: () => void }) {
  const s = useTint();
  const c = usePalette();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 760 && height >= 480;

  // ---- flow state (pipeline calls are the hill climb's, unchanged) ----
  const params = useLocalSearchParams<{ check?: string }>();
  const handle = uploadRoute({ pending: params.check }).pendingId;
  const [selection, setSelection] = useState<Selection>();
  const [link, setLink] = useState('');
  const [job, setJob] = useState<ClientJob>();
  const [busy, setBusy] = useState(false);
  /** The upload (or link) failed: shown on the preview, or on the check step after a reload. */
  const [failure, setFailure] = useState('');
  /** A pick that can't be sent (wrong type, too big, not a link): shown on the pick step. */
  const [pickError, setPickError] = useState('');
  /** Polling a running check lost the connection; clears itself on the next good poll. */
  const [notice, setNotice] = useState('');
  /** A reload's ?check= couldn't be found yet. */
  const [recoverError, setRecoverError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const player = useRef<EvidencePlayerHandle>(null);
  // A step's link opens its evidence card and spotlight, or scrubs to the moment it looked at.
  const follow = useCallback((l: StepLink) => (l.evidenceId ? player.current?.show(l.evidenceId) : player.current?.seekTo(l.t0)), []);
  const [over, setOver] = useState(false);
  const [clipLength, setClipLength] = useState<number>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  /** The cloud didn't answer whether this is a prepared check: "Try again" repeats the whole check. */
  const [lookupDown, setLookupDown] = useState(false);
  /** A prepared check being shown: its video plays from the cloud, and nothing polls the job runner. */
  const [demo, setDemo] = useState<Prepared>();
  /** A prepared check's steps as they play back in the card, and how many rows have finished. */
  const [replay, setReplay] = useState<{ steps: InvestigationSummary['steps']; done: number }>();
  const markPreviewFailed = useCallback(() => setPreviewFailed(true), []);
  const generation = useRef(0);
  const locked = useRef(false);
  const retry = useRef<Request | undefined>(undefined);
  // What the preview and result show while they fade out after a selection or check is dropped.
  const shownSelection = useLatched(selection, 420);
  /** Frees the last file preview's object URL (in event handlers, so Strict Mode's effect replays can't revoke a live one). */
  const releasePreview = useRef<() => void>(() => {});
  // Starting a check needs a real account (not a guest). Saved checks (?check=) stay open to anyone.
  const allowed = canUpload(useAuth().status);
  // Sign-in is its own sheet: the card steps aside for it (one modal at a time, which iOS needs)
  // and comes back at the pick step once they've signed in.
  const askSignIn = useCallback(() => {
    onClose();
    setTimeout(() => requireMember(SIGN_IN_REASON, () => onOpen?.()), 320);
  }, [onClose, onOpen]);

  const jobFailed = job?.state === 'error';
  const complete = job?.state === 'complete' && !!job.result;
  // The preview player goes away once the result has faded in, so no hidden <video> lingers under it.
  const [previewLive] = usePresence(!complete, 900);
  const previewUri = shownSelection?.kind === 'file' && previewLive ? shownSelection.preview.uri : '';
  // A prepared check's playback has nothing to lose, so leaving it never asks.
  const running = !demo && (busy || job?.state === 'queued' || job?.state === 'running');
  const checking = busy || (!!job && !jobFailed);
  const step = checking ? 2 : selection ? 1 : job || handle ? 2 : 0;
  const failureText = failure || (jobFailed ? job?.error || 'This video could not be checked.' : '');
  const linkReady = !!link.trim();
  const resultJob = useLatched(complete ? job : undefined, 520);

  // ---- motion ----
  const [mounted, shown] = usePresence(open, 280);
  const pos = useEased(step, 340);
  // The result waits for the progress bar to finish its run to the end.
  const resultIn = useEased(complete ? 1 : 0, 360, EASE_OUT, complete ? 440 : 0);
  /** Desktop: 0 = the compact pick card, 1 = the full square for the preview and on. */
  const grow = useEased(step >= 1 ? 1 : 0, 440, EASE_IN_OUT);
  /** Desktop: 0 = the square card, 1 = widened with the result panel. */
  const wide = useEased(desktop && complete ? 1 : 0, 460, EASE_IN_OUT, complete ? 440 : 0);

  const close = useCallback(() => {
    if (running) setConfirm(true);
    else onClose();
  }, [running, onClose]);

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (confirm) setConfirm(false);
      else close();
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (running) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', unload);
    };
  }, [open, running, confirm, close]);

  // Warm the cloud lookup as Create opens, so the first real one doesn't pay for a cold start.
  useEffect(() => {
    if (open) void lookupDemoCheckStatus({ sha256: '0'.repeat(64) }, { timeoutMs: 4000 });
  }, [open]);

  // Reload mid-check: the URL's ?check= key picks the job back up once the server has it.
  useEffect(() => {
    if (!open || !handle || busy || job) return;
    let alive = true;
    const gen = generation.current;
    const recover = () => {
      void acceptUpload(handle, () => getJob(handle), (j) => {
        if (alive && gen === generation.current) {
          setJob(j);
          setRecoverError('');
        }
      }).catch((e: Error) => {
        if (alive && gen === generation.current) setRecoverError(e.message);
      });
    };
    recover();
    const timer = setInterval(recover, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, handle, busy, job]);

  useEffect(() => {
    if (!open || !job || demo || !['queued', 'running'].includes(job.state)) return;
    let alive = true;
    const gen = generation.current;
    const timer = setInterval(() => {
      void getJob(job.id)
        .then((j) => {
          if (alive && gen === generation.current) {
            setJob(j);
            setNotice('');
          }
        })
        .catch((e: Error) => {
          if (alive && gen === generation.current) setNotice(e.message);
        });
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, job, demo]);

  async function perform(request: Request) {
    if (locked.current) return;
    locked.current = true;
    const gen = ++generation.current;
    setBusy(true);
    setJob(undefined);
    setDemo(undefined);
    setReplay(undefined);
    setFailure('');
    setNotice('');
    retry.current = request;
    setCanRetry(true);
    router.setParams({ check: request.id });
    try {
      await acceptUpload(request.id, () => sendOrRecover(request.send, () => getJob(request.id)), (j) => {
        if (gen === generation.current) setJob(j);
      });
    } catch (e) {
      if (gen === generation.current) setFailure((e as Error).message);
    } finally {
      if (gen === generation.current) {
        setBusy(false);
        locked.current = false;
      }
    }
  }

  function retryCheck() {
    if (job?.state === 'error' && job.retryable) {
      const id = job.id;
      void perform({ id, send: () => retryAnalysis(id) });
    } else if (retry.current) void perform(retry.current);
  }

  async function check() {
    if (!selection || locked.current) return;
    if (!allowed) return askSignIn();
    const chosen = selection;
    // A prepared check for this exact file or post plays from the cloud; anything else goes to the job runner.
    locked.current = true;
    const gen = ++generation.current;
    setBusy(true);
    setJob(undefined);
    setFailure('');
    setNotice('');
    setLookupDown(false);
    const sha256 = chosen.kind === 'file' ? await chosen.sha256 : undefined;
    const key: DemoQuery | null = chosen.kind === 'file' ? (sha256 ? { sha256 } : null) : { url: chosen.url };
    const lookup = key ? await lookupWithRetry(key, gen) : ({ status: 'not_found' } as const);
    if (gen !== generation.current) return;
    if (lookup.status === 'unavailable') {
      // Slow or blocked cloud (venue Wi-Fi): say so in the card and keep the pick, rather than
      // treating it as "not prepared" and sending it to a job runner that may not be there.
      setBusy(false);
      setLookupDown(true);
      setFailure('Couldn’t reach Double Take just now. Check the connection and try again.');
      locked.current = false;
      return;
    }
    const prepared = lookup.status === 'found' ? preparedJob(lookup.check) : null;
    if (prepared) return playPrepared(prepared, gen, chosen.kind === 'file' ? chosen.asset.size ?? 0 : 0);
    // Not a prepared check: the job runner (where none is configured, this ends at its usual "unavailable").
    locked.current = false;
    const id = uploadId(uuid, (bytes) => Crypto.getRandomValues(bytes));
    void perform({ id, send: () => (chosen.kind === 'file' ? upload(id, chosen.asset) : uploadLink(id, chosen.url)) });
  }

  /** The prepared-check lookup, tried up to three times (about 9 s in all) while the progress keeps moving. */
  async function lookupWithRetry(key: DemoQuery, gen: number): Promise<DemoLookup> {
    let last: DemoLookup = { status: 'unavailable' };
    for (const [i, timeoutMs] of [2500, 2500, 3000].entries()) {
      if (i) await new Promise((r) => setTimeout(r, i * 400));
      if (gen !== generation.current) return last;
      last = await lookupDemoCheckStatus(key, { timeoutMs });
      if (last.status !== 'unavailable') return last;
    }
    return last;
  }

  /**
   * Shows a prepared check the way a live one goes: a few believable seconds of
   * uploading (longer for bigger files), then checking, then its stored result.
   * The progress bar only moves forward through it.
   */
  async function playPrepared(prepared: Prepared, gen: number, bytes: number) {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const live = () => gen === generation.current;
    retry.current = undefined;
    setCanRetry(false);
    setDemo(prepared);
    await wait(900 + Math.min(1400, bytes / 20000));
    if (!live()) return;
    // Then the check plays back step by step: each row's recorded time, scaled so the
    // whole run takes about 6–8 s, and never less than 0.4 s a step.
    const steps = prepared.job.result?.investigation?.steps ?? [];
    const rows = rowsOf(steps);
    const ms = rows.map((r) => (r.decision?.elapsedMs ?? 0) + r.step.elapsedMs);
    const scale = Math.min(1, 6000 / Math.max(1, ms.reduce((a, b) => a + b, 0)));
    setBusy(false);
    setReplay({ steps, done: 0 });
    setJob({ ...prepared.job, state: 'running', result: undefined });
    for (let i = 0; i < rows.length; i++) {
      await wait(Math.max(400, Math.min(2200, ms[i] * scale)));
      if (!live()) return;
      setReplay({ steps, done: i + 1 });
    }
    await wait(rows.length ? 700 : 2600);
    if (!live()) return;
    setJob(prepared.job);
    locked.current = false;
  }

  function takeFile(asset: DocumentPicker.DocumentPickerAsset) {
    if (!allowed) return askSignIn();
    const problem = pickProblem(asset);
    if (problem) {
      setPickError(problem);
      return;
    }
    setPickError('');
    setFailure('');
    setClipLength(undefined);
    setPreviewFailed(false);
    releasePreview.current();
    const preview = previewSource(asset);
    releasePreview.current = preview.release;
    setSelection({ kind: 'file', asset, preview, sha256: hashAsset(asset).catch(() => null) });
  }

  function takeLink() {
    if (!allowed) return askSignIn();
    const url = normalizeLink(link);
    if (!url) {
      setPickError('Paste a full link to a public video.');
      return;
    }
    setPickError('');
    setFailure('');
    setSelection({ kind: 'link', url });
  }

  async function choose() {
    if (!allowed) return askSignIn();
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/quicktime'], copyToCacheDirectory: true, base64: false });
      if (!picked.canceled) takeFile(picked.assets[0]);
    } catch {
      setPickError('Could not open your files. Try again.');
    }
  }

  /** Back to the pick step, dropping the selection and any finished or failed check. */
  function startOver() {
    generation.current++;
    locked.current = false;
    retry.current = undefined;
    setCanRetry(false);
    // The preview fades out still showing the clip: free its object URL once it's gone.
    const release = releasePreview.current;
    releasePreview.current = () => {};
    setTimeout(release, 800);
    setSelection(undefined);
    setJob(undefined);
    setDemo(undefined);
    setReplay(undefined);
    setLookupDown(false);
    setBusy(false);
    setFailure('');
    setNotice('');
    setRecoverError('');
    setPickError('');
    if (handle) router.setParams({ check: undefined });
  }

  // ---- layout ----
  const S = Math.floor(Math.max(300, Math.min(height - 2 * MARGIN - HEADER, width - 2 * MARGIN - PANEL, 640)));
  const bodyW = desktop ? S : width;
  const bodyH = desktop ? S : height - insets.top - insets.bottom - HEADER;
  const phase = step === 0 ? 'pick' : step === 1 ? 'preview' : complete ? 'result' : 'check';

  const titles: [boolean, string][] = [
    [phase === 'pick', 'Check a video'],
    [phase === 'preview', 'Preview'],
    [phase === 'check', failureText || recoverError ? 'Check a video' : 'Checking'],
    [phase === 'result', 'Result'],
  ];
  const title = (
    <View pointerEvents="none" style={{ width: 200, height: HEADER }}>
      {titles.map(([on, t], i) => (
        <Swap key={i} on={on}>
          <Text style={s.title} numberOfLines={1}>
            {t}
          </Text>
        </Swap>
      ))}
    </View>
  );
  const left = (
    <View style={{ width: 56, height: HEADER }}>
      <Swap on={phase === 'preview'}>
        <IconButton icon="arrow-back" label="Back" onPress={startOver} />
      </Swap>
      {!desktop && (
        <Swap on={phase !== 'preview'}>
          <IconButton icon="close" label="Close" onPress={close} />
        </Swap>
      )}
    </View>
  );
  const right = (
    <View style={{ width: 96, height: HEADER }}>
      <Swap on={phase === 'pick' && linkReady && allowed} style={{ alignItems: 'flex-end' }}>
        <HeaderAction label="Next" onPress={takeLink} />
      </Swap>
      <Swap on={phase === 'preview'} style={{ alignItems: 'flex-end' }}>
        <HeaderAction label="Check" onPress={check} disabled={busy} />
      </Swap>
      <Swap on={phase === 'result'} style={{ alignItems: 'flex-end' }}>
        <HeaderAction label="Done" onPress={onClose} />
      </Swap>
    </View>
  );

  const inspection = resultJob?.result?.inspection;
  const hasMoments = !!resultJob?.result && (resultJob.result.mode === 'fixture' || resultJob.result.evidence.some((e) => e.tell));
  const overall = resultJob?.result?.verdict;
  const trace = resultJob?.result?.investigation;
  const links = useMemo(() => stepLinks(resultJob?.result), [resultJob]);
  // With an overall call it leads. Under it, "How we checked" when the result has the run; older
  // checks keep their per-part rows.
  const verdict = resultJob?.result ? (
    <>
      {overall && <VerdictHeadline verdict={overall} />}
      {trace ? (
        <HowWeChecked trace={trace} links={links} verdict={overall} onLink={follow} />
      ) : (
        <Assessments components={resultJob.result.components} fixture={resultJob.result.mode === 'fixture'} inspection={inspection} title={overall ? 'Details' : undefined} />
      )}
    </>
  ) : null;
  // What's still useful from the per-part rows the timeline replaces, then the file notes.
  const fileNotes = (
    <>
      {trace && <WouldHelp inspection={inspection} />}
      {inspection && <FileNotes signals={inspection.signals} />}
    </>
  );
  const another = <Button label="Check another video" onPress={startOver} wide />;
  // The video stays pinned at the top while the evidence moments (and on phones the findings) scroll under it.
  const result = resultJob?.result ? (
    <EvidencePlayer
      key={resultJob.id}
      pinned
      uri={demo?.job.id === resultJob.id ? demo.mediaUrl : mediaUrl(resultJob.id)}
      width={resultJob.width}
      height={resultJob.height}
      duration={resultJob.duration}
      preview={resultJob.result.mode === 'fixture'}
      evidence={resultJob.result.evidence}
      lead={desktop ? null : verdict}
      ref={player}
      maxStageHeight={desktop ? (hasMoments ? S * 0.6 : S - 64) : bodyH * 0.36}
    >
      {!desktop && (
        <>
          {fileNotes}
          {another}
        </>
      )}
    </EvidencePlayer>
  ) : null;

  const body = (
    <Body
      w={bodyW}
      h={bodyH}
      step={step}
      pos={pos}
      resultIn={resultIn}
      grow={desktop ? grow : undefined}
      compactScale={desktop ? Math.min(1, COMPACT / S) : 1}
      media={previewUri ? <ClipPreview uri={previewUri} paused={complete} onDuration={setClipLength} onFail={markPreviewFailed} /> : null}
      pick={
        <View style={{ flex: 1 }}>
          <Swap on={allowed} style={{ alignItems: 'stretch', justifyContent: 'flex-start' }}>
        <DropZone onFile={takeFile} onOver={setOver}>
          <PickStep
            desktop={desktop}
            glowInset={desktop ? (S - Math.min(S, COMPACT)) / 2 + 12 : 12}
            over={over}
            link={link}
            onLink={(t) => {
              setLink(t);
              if (pickError) setPickError('');
            }}
            onSubmitLink={takeLink}
            onChoose={choose}
            error={pickError}
          />
        </DropZone>
          </Swap>
          {/* Guests and signed-out viewers: the same card asks for an account first. */}
          <Swap on={!allowed}>
            <View style={{ alignItems: 'center', gap: 16, padding: 28 }}>
              <Ionicons name="person-circle-outline" size={64} color={c.text} />
              <Text style={s.big}>{SIGN_IN_REASON}</Text>
              <Button label="Sign in" onPress={askSignIn} />
            </View>
          </Swap>
        </View>
      }
      preview={
        shownSelection && (
          <View style={{ flex: 1 }}>
            {shownSelection.kind === 'link' ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
                <View style={s.linkIcon}>
                  <Ionicons name="link" size={28} color={c.text} />
                </View>
                <Text style={s.big} numberOfLines={1}>
                  {new URL(shownSelection.url).hostname.replace(/^www\./, '')}
                </Text>
                <Text style={[s.muted, { textAlign: 'center', maxWidth: 360 }]} numberOfLines={2}>
                  {shownSelection.url}
                </Text>
              </View>
            ) : (
              <>
                <Reveal on={previewFailed} style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
                  <Ionicons name="film-outline" size={40} color={c.textDim} />
                  <Text style={[s.muted, { textAlign: 'center' }]}>No preview for this file</Text>
                </Reveal>
                <Reveal on={!!clipLength && !failureText} style={{ position: 'absolute', right: 12, bottom: 12 }}>
                  <View style={s.chip}>
                    <Text style={s.chipText}>{clipLength ? clock(clipLength) : ''}</Text>
                  </View>
                </Reveal>
              </>
            )}
            <Reveal on={!!failureText && !busy} style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
              <ErrorNote
                text={failureText}
                actions={
                  <>
                    {lookupDown ? <Button label="Try again" onPress={check} /> : (canRetry || job?.retryable) && <Button label="Try again" onPress={retryCheck} />}
                    <Button label={shownSelection.kind === 'link' ? 'Change link' : 'Choose another'} kind="quiet" onPress={startOver} />
                  </>
                }
              />
            </Reveal>
          </View>
        )
      }
      progress={
        // Uploading: the progress bar. Then the check itself, its steps arriving as they run.
        // (Both only 'on' at this step: a hidden step's layers must never take clicks on web.)
        <View style={{ position: 'absolute', inset: 0 }}>
          <Swap on={step === 2 && (busy || !job || job.state === 'queued')}>
            <View style={{ width: Math.min(320, bodyW - 64), gap: 4 }}>
              <Processing key={handle ?? 'check'} uploading={busy} stage={job?.state} />
              <Text style={[s.muted, { minHeight: 18 }]}>{notice || (job?.state === 'queued' ? 'Waiting to check' : '')}</Text>
            </View>
          </Swap>
          <Swap on={step === 2 && !busy && !!job && job.state !== 'queued'}>
            <LiveTrace
              steps={replay?.steps ?? job?.result?.investigation?.steps ?? []}
              done={replay ? replay.done : Infinity}
              working={job?.state === 'running' && (!replay || replay.done < rowsOf(replay.steps).length)}
              replay={!!demo}
              width={Math.min(440, bodyW - 32)}
              maxHeight={bodyH - 48}
            />
          </Swap>
        </View>
      }
      stepFailure={
        (failureText || recoverError) && !selection && !busy ? (
          <View style={{ width: Math.min(400, bodyW - 48) }}>
            <ErrorNote text={failureText || recoverError} actions={<>{job?.retryable && <Button label="Try again" onPress={retryCheck} />}<Button label="Choose a video" onPress={startOver} /></>} />
          </View>
        ) : null
      }
      result={result}
    />
  );

  const confirmLayer = (
    <Reveal on={confirm} style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Pressable accessibilityLabel="Keep checking" onPress={() => setConfirm(false)} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
      <View style={[s.surface, { borderRadius: 14, padding: 22, gap: 14, width: '100%', maxWidth: 340 }]}>
        <Text style={s.heading}>Leave this check?</Text>
        <Text style={s.muted}>It keeps going in the background. Open Create again to see the result.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            label="Leave"
            kind="quiet"
            onPress={() => {
              setConfirm(false);
              onClose();
            }}
          />
          <Button label="Keep checking" onPress={() => setConfirm(false)} />
        </View>
      </View>
    </Reveal>
  );

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={close} statusBarTranslucent>
      <Backdrop shown={shown} onPress={close} />
      {desktop ? (
        <DesktopCard
          shown={shown}
          grow={grow}
          wide={wide}
          S={S}
          compact={COMPACT}
          title={title}
          left={left}
          right={right}
          body={body}
          panel={
            verdict ? (
              <View style={{ flex: 1 }}>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 24 }}>
                  {verdict}
                  {fileNotes}
                </ScrollView>
                <View style={{ padding: 20, paddingTop: 12 }}>{another}</View>
              </View>
            ) : null
          }
          confirm={confirmLayer}
          onClose={close}
        />
      ) : (
        <PhoneSheet shown={shown} height={height} top={insets.top} bottom={insets.bottom} title={title} left={left} right={right} body={body} confirm={confirmLayer} />
      )}
    </Modal>
  );
}

function Backdrop({ shown, onPress }: { shown: SharedValue<number>; onPress: () => void }) {
  const a = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.72)' }, ownLayer, a]}>
      <Pressable accessibilityLabel="Close" onPress={onPress} style={{ flex: 1 }} />
    </Animated.View>
  );
}

/**
 * The card on desktop. It starts as a compact square for picking and grows
 * (`grow`) to the full square for the preview; for the result its square
 * half and the panel slide apart (`wide`). Its surfaces are separate pieces
 * moved by transforms only: a header strip that only stretches sideways (so
 * the header keeps its height), a body that scales, and the panel that sits
 * behind the square and slides out to the right while the card re-centres.
 * Nothing animates width or height.
 */
function DesktopCard(props: {
  shown: SharedValue<number>;
  grow: SharedValue<number>;
  wide: SharedValue<number>;
  S: number;
  /** The pick step's body size (≤ S). */
  compact: number;
  title: ReactNode;
  left: ReactNode;
  right: ReactNode;
  body: ReactNode;
  panel: ReactNode;
  confirm: ReactNode;
  onClose: () => void;
}) {
  const { shown, grow, wide, S, compact, title, left, right, body, panel, confirm, onClose } = props;
  const s = useTint();
  const W = S + PANEL;
  const H = S + HEADER;
  const OVERLAP = 28;
  const k = Math.min(1, compact / S);
  const card = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.94 + shown.value * 0.06 }] }));
  const closeBtn = useAnimatedStyle(() => ({ opacity: shown.value }));
  // f: the square's scale; inset: how far each side of the square is pulled in; T: how far the header drops.
  // The header's middle stretches sideways between two fixed corner caps, so its corners stay round.
  const headerMid = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    return { transform: [{ translateX: ((1 - wide.value) * PANEL) / 2 }, { translateY: (S * (1 - f)) / 2 }, { scaleX: (f * S - 2 * CAP + 2) / S }] };
  });
  const capLeft = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    return {
      borderTopLeftRadius: RADIUS_COMPACT + grow.value * (RADIUS - RADIUS_COMPACT),
      transform: [{ translateX: ((1 - wide.value) * PANEL) / 2 + (S * (1 - f)) / 2 }, { translateY: (S * (1 - f)) / 2 }],
    };
  });
  const capRight = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    return {
      borderTopRightRadius: RADIUS_COMPACT + grow.value * (RADIUS - RADIUS_COMPACT),
      transform: [{ translateX: ((1 - wide.value) * PANEL) / 2 - (S * (1 - f)) / 2 }, { translateY: (S * (1 - f)) / 2 }],
    };
  });
  // The body scales, so its radius is set in unscaled units to look the same as the header's.
  const bodySurface = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    const r = (RADIUS_COMPACT + grow.value * (RADIUS - RADIUS_COMPACT)) / f;
    return { borderBottomLeftRadius: r, borderBottomRightRadius: r, transform: [{ translateX: ((1 - wide.value) * PANEL) / 2 }, { scale: f }] };
  });
  const leftSlot = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    return { transform: [{ translateX: ((1 - wide.value) * PANEL) / 2 + (S * (1 - f)) / 2 }, { translateY: (S * (1 - f)) / 2 }] };
  });
  const rightSlot = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    return { transform: [{ translateX: (-(1 - wide.value) * PANEL) / 2 - (S * (1 - f)) / 2 }, { translateY: (S * (1 - f)) / 2 }] };
  });
  const titleSlot = useAnimatedStyle(() => {
    const f = k + grow.value * (1 - k);
    return { transform: [{ translateY: (S * (1 - f)) / 2 }] };
  });
  const squareSide = useAnimatedStyle(() => ({ transform: [{ translateX: ((1 - wide.value) * PANEL) / 2 }] }));
  const panelSurface = useAnimatedStyle(() => ({
    opacity: interpolate(wide.value, [0, 0.06], [0, 1], 'clamp'),
    transform: [{ translateX: (-(1 - wide.value) * PANEL) / 2 }],
  }));
  const panelContent = useAnimatedStyle(() => ({
    opacity: interpolate(wide.value, [0.35, 1], [0, 1], 'clamp'),
    transform: [{ translateX: (-(1 - wide.value) * PANEL) / 2 }],
  }));
  return (
    <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', top: 12, right: 12 }, ownLayer, closeBtn]}>
        <IconButton icon="close" label="Close" onPress={onClose} size={28} color="#fff" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal pointerEvents="box-none" style={[{ width: W, height: H }, ownLayer, card]}>
        {/* Panel surface first so the square covers it while it's tucked away. */}
        <Animated.View style={[s.surface, { position: 'absolute', top: 0, left: S - OVERLAP, width: PANEL + OVERLAP, height: H, borderRadius: 14 }, ownLayer, panelSurface]}>
          <View style={[s.hairline, { position: 'absolute', top: HEADER, left: 0, right: 0 }]} />
        </Animated.View>
        <Animated.View style={[s.surface, { position: 'absolute', top: HEADER, left: 0, width: S, height: S }, ownLayer, bodySurface]} />
        <Animated.View style={[s.surface, { position: 'absolute', top: 0, left: 0, width: S, height: HEADER + 1 }, ownLayer, headerMid]}>
          <View style={[s.hairline, { position: 'absolute', bottom: 0, left: 0, right: 0 }]} />
        </Animated.View>
        {[capLeft, capRight].map((cap, i) => (
          <Animated.View key={i} style={[s.surface, { position: 'absolute', top: 0, left: i ? S - CAP : 0, width: CAP, height: HEADER + 1, overflow: 'hidden' }, ownLayer, cap]}>
            <View style={[s.hairline, { position: 'absolute', bottom: 0, left: 0, right: 0 }]} />
          </Animated.View>
        ))}
        <Animated.View style={[{ position: 'absolute', top: HEADER + 1, left: S, width: PANEL, height: S - 1 }, ownLayer, panelContent]}>{panel}</Animated.View>
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: HEADER + 1, left: 0, width: S, height: S - 1 }, ownLayer, squareSide]}>
          {body}
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', top: 0, left: 4 }, ownLayer, leftSlot]}>{left}</Animated.View>
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: HEADER, alignItems: 'center' }, ownLayer, titleSlot]}>
          {title}
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', top: 0, right: 4 }, ownLayer, rightSlot]}>{right}</Animated.View>
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, left: 0, width: S, height: H }, ownLayer, squareSide]}>
          {confirm}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Phones: the same header and steps in a full-screen sheet that slides up. */
function PhoneSheet(props: { shown: SharedValue<number>; height: number; top: number; bottom: number; title: ReactNode; left: ReactNode; right: ReactNode; body: ReactNode; confirm: ReactNode }) {
  const { shown, height, top, bottom, title, left, right, body, confirm } = props;
  const s = useTint();
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * height }] }));
  return (
    <Animated.View accessibilityViewIsModal style={[s.surface, { position: 'absolute', inset: 0, paddingTop: top, paddingBottom: bottom }, ownLayer, sheet]}>
      <View style={{ height: HEADER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ paddingLeft: 4 }}>{left}</View>
        {title}
        <View style={{ paddingRight: 4 }}>{right}</View>
      </View>
      <View style={s.hairline} />
      <View style={{ flex: 1 }}>{body}</View>
      {confirm}
    </Animated.View>
  );
}

/** The steps, stacked in the card's body; `pos` slides between them. */
function Body(props: {
  w: number;
  h: number;
  step: number;
  pos: SharedValue<number>;
  resultIn: SharedValue<number>;
  /** Desktop: the card's growth from the compact pick card, and that card's scale; the clip grows with it. */
  grow?: SharedValue<number>;
  compactScale?: number;
  media: ReactNode;
  pick: ReactNode;
  preview: ReactNode;
  progress: ReactNode;
  stepFailure: ReactNode;
  result: ReactNode;
}) {
  const { w, h, step, pos, resultIn, grow, compactScale = 1, media, pick, preview, progress, stepFailure, result } = props;
  // The picked clip stays put under the preview and check steps and fades away for the pick step and the result.
  const mediaStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pos.value, [0, 1], [0, 1], 'clamp') * (1 - resultIn.value),
    transform: [{ scale: compactScale + (grow ? grow.value : 1) * (1 - compactScale) }],
  }));
  const scrim = useAnimatedStyle(() => ({ opacity: interpolate(pos.value, [1, 2], [0, 1], 'clamp') * (1 - resultIn.value) }));
  const progressStyle = useAnimatedStyle(() => ({ opacity: 1 - resultIn.value, transform: [{ scale: 1 - resultIn.value * 0.04 }] }));
  const resultStyle = useAnimatedStyle(() => ({ opacity: resultIn.value, transform: [{ translateY: (1 - resultIn.value) * 16 }] }));
  return (
    <View style={{ width: w, height: h }}>
      {media && (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, overflow: 'hidden' }, ownLayer, mediaStyle]}>
          {media}
        </Animated.View>
      )}
      {media && <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)' }, ownLayer, scrim]} />}
      <StepLayer index={0} pos={pos} current={step}>
        {pick}
      </StepLayer>
      {preview && (
        <StepLayer index={1} pos={pos} current={step}>
          {preview}
        </StepLayer>
      )}
      <StepLayer index={2} pos={pos} current={step} slide={0}>
        <Animated.View pointerEvents={step === 2 && !result ? 'box-none' : 'none'} style={[{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }, ownLayer, progressStyle]}>
          {stepFailure ?? progress}
        </Animated.View>
        {result && <Animated.View pointerEvents={step === 2 ? 'auto' : 'none'} style={[{ position: 'absolute', inset: 0 }, ownLayer, resultStyle]}>{result}</Animated.View>}
      </StepLayer>
    </View>
  );
}

function PickStep(props: { desktop: boolean; glowInset: number; over: boolean; link: string; onLink: (t: string) => void; onSubmitLink: () => void; onChoose: () => void; error: string }) {
  const { desktop, glowInset, over, link, onLink, onSubmitLink, onChoose, error } = props;
  const s = useTint();
  const c = usePalette();
  const lift = useEased(over ? 1 : 0, 200);
  // Phones: the keyboard would cover the link field, so the step rises with it (eased, by transform).
  const rise = useSharedValue(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      rise.value = withTiming(e.endCoordinates.height * 0.5, { duration: e.duration || 250, easing: EASE_OUT });
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      rise.value = withTiming(0, { duration: e.duration || 250, easing: EASE_OUT });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [rise]);
  const raised = useAnimatedStyle(() => ({ transform: [{ translateY: -rise.value }] }));
  const glow = useAnimatedStyle(() => ({ opacity: lift.value }));
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: 1 + lift.value * 0.12 }, { translateY: -lift.value * 4 }] }));
  return (
    <View style={{ flex: 1 }}>
      <Animated.View pointerEvents="none" style={[s.glow, { position: 'absolute', inset: glowInset }, ownLayer, glow]} />
      <Animated.View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 }, raised]}>
        <Animated.View style={[ownLayer, icon]}>
          <Ionicons name="videocam-outline" size={64} color={c.text} />
        </Animated.View>
        <Text style={s.big}>{desktop ? 'Drag a video here' : 'Choose a video'}</Text>
        <Button label="Select from device" onPress={onChoose} />
        <Text style={s.muted}>MP4 or MOV · up to 60 seconds · 100 MB</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', maxWidth: 340, marginTop: 8 }}>
          <View style={s.rule} />
          <Text style={s.muted}>or</Text>
          <View style={s.rule} />
        </View>
        {/* The error hangs below the field so nothing above it moves when it shows. */}
        <View style={[s.field, { width: '100%', maxWidth: 340 }]}>
          <Ionicons name="link" size={18} color={c.textDim} />
          <TextInput
            accessibilityLabel="Video link"
            placeholder="Paste a video link"
            placeholderTextColor={c.textDim}
            value={link}
            onChangeText={onLink}
            onSubmitEditing={onSubmitLink}
            returnKeyType="next"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[s.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
          />
          <Reveal on={!!error} style={{ position: 'absolute', top: 52, left: 0, right: 0 }}>
            <ErrorNote text={error} />
          </Reveal>
        </View>
      </Animated.View>
    </View>
  );
}
