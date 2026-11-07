import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { readTellsFile, type UnplacedClaim } from '@/annotations/format';
import { compareMoments, seekTimeFor, stepCopy, walkthroughSteps, type Moment } from '@/annotations/walkthrough';
import { activeTells, boxOnStage, cardPlacement, videoRect, type Box, type Fit, type Tell } from './tells';

interface Props {
  /** Signed URL of the clip's tells JSON. */
  url: string;
  player: VideoPlayer | null;
  stageW: number;
  stageH: number;
  aspect: number;
  /** How the video is fitted right now (the walkthrough asks for `contain`). */
  fit: Fit;
  /** Distance of the reveal button from the top of the stage. */
  top: number;
  paused: boolean;
  onPause: () => void;
  onPlay: () => void;
  /** The walkthrough started or ended: the clip shows the whole frame and hides its chrome meanwhile. */
  onInspect: (on: boolean) => void;
}

interface Loaded {
  steps: Tell[];
  /** Claims with no place on the video; shown on a closing card. */
  unplaced: UnplacedClaim[];
}

async function loadTells(url: string): Promise<Loaded> {
  try {
    const res = await fetch(url); // signed URL, so no auth header
    if (!res.ok) return { steps: [], unplaced: [] };
    const file = readTellsFile(await res.json());
    return { steps: walkthroughSteps(file.tells), unplaced: file.unplaced ?? [] };
  } catch {
    return { steps: [], unplaced: [] };
  }
}

/**
 * Seeking is a property write on the player; kept out of the component body.
 * Pause first, synchronously: the feed's own pause lands in an effect after
 * this render, and a seek that races it (playing → paused) showed a stale,
 * half-decoded frame on the iOS Simulator instead of the target frame.
 */
function seekTo(player: VideoPlayer, seconds: number) {
  player.pause();
  player.currentTime = seconds;
}

/**
 * "Reveal AI tells": a step-by-step walkthrough of the clip's tells.
 *
 * Each step pauses on the moment the tell is clearest, spotlights its box and
 * explains it, with where the claim came from and whether anyone has checked
 * it (model drafts say so). Play from any step and the boxes follow the video;
 * the card follows whichever tell is on screen. Mounted only for the active
 * clip, so every visit starts closed.
 */
export function TellOverlay(p: Props) {
  const [step, setStep] = useState<number | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [t, setT] = useState(0);
  /** Which before/after moment a paused step shows (time of it), or null for its focus frame. */
  const [moment, setMoment] = useState<number | null>(null);
  const { player, onInspect } = p;

  // Leaving the clip unmounts us; make sure the clip goes back to normal.
  useEffect(() => () => onInspect(false), [onInspect]);

  const goTo = (i: number, list: Tell[]) => {
    setStep(i);
    setMoment(null);
    p.onPause();
    if (player) {
      const at = seekTimeFor(list[i]);
      seekTo(player, at);
      setT(at);
    }
    Haptics.selectionAsync().catch(() => {});
  };

  const open = async () => {
    let d = data;
    if (!d) {
      d = await loadTells(p.url);
      setData(d);
    }
    if (!d.steps.length && !d.unplaced.length) {
      setStep(-1); // "No tells found"
      return;
    }
    onInspect(true);
    if (d.steps.length) goTo(0, d.steps);
    else {
      setStep(0); // only the "also claimed" card
      p.onPause();
    }
  };

  const close = () => {
    setStep(null);
    onInspect(false);
    p.onPlay();
  };

  const steps = data?.steps ?? [];
  const unplaced = data?.unplaced ?? [];
  const count = steps.length + (unplaced.length ? 1 : 0);
  const current = step !== null && step >= 0 && step < steps.length ? steps[step] : undefined;
  const onSummary = step !== null && step >= 0 && step === steps.length && unplaced.length > 0;
  const live = !p.paused && current ? activeTells(steps, t) : [];

  // While playing, the card follows whichever tell is on screen.
  const onTime = (time: number) => {
    setT(time);
    if (p.paused || !current) return;
    const now = activeTells(steps, time);
    if (now.length && !now.includes(current)) setStep(steps.indexOf(now[0]));
  };

  const frame = videoRect(p.stageW, p.stageH, p.aspect, p.fit);
  const onStage = (b: Box | undefined) => (b ? boxOnStage(b, frame, p.stageW, p.stageH) : null);
  const focusRect = current && (p.paused || live.includes(current)) ? onStage(current.box) : null;
  const shown = p.paused ? (current ? [current] : []) : live;
  const cardH = 196;
  const placement = cardPlacement(focusRect, p.stageH, cardH, p.top + 44);

  return (
    <>
      {player && step !== null && step >= 0 && <PlayerClock player={player} onTime={onTime} />}
      {step !== null && step >= 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {focusRect && p.paused && <Spotlight rect={focusRect} stageW={p.stageW} stageH={p.stageH} />}
          {shown.map((tell) => {
            const r = onStage(tell.box);
            if (!r) return null;
            return <View key={tell.id} style={[styles.box, tell !== current && styles.boxDim, { left: r.x, top: r.y, width: r.w, height: r.h }]} />;
          })}
          {(() => {
            // Only the current tell is labelled (overlapping boxes would stack labels). The
            // label sits on the stage, not inside the box, so a small box doesn't squeeze it.
            const r = current && shown.includes(current) ? onStage(current.box) : null;
            if (!r || !current) return null;
            const above = r.y - LABEL_H > p.top + 36;
            const anchorRight = r.x + LABEL_MAX_W > p.stageW;
            return (
              <View
                style={[
                  styles.label,
                  above
                    ? { bottom: p.stageH - r.y + 4 }
                    : { top: r.y + r.h + LABEL_H + 4 < p.stageH ? r.y + r.h + 4 : r.y + 4 }, // below the box, else inside it
                  anchorRight ? { right: Math.max(0, p.stageW - (r.x + r.w) - 2.5) } : { left: Math.max(0, r.x - 2.5) },
                ]}
              >
                <Text style={styles.labelText} numberOfLines={2}>
                  {current.label}
                </Text>
              </View>
            );
          })()}
        </View>
      )}

      {current && (
        <StepCard
          tell={current}
          index={step!}
          count={count}
          paused={p.paused}
          style={placement === 'top' ? { top: p.top + 44 } : { bottom: 16 }}
          onPrev={() => goTo(Math.max(0, step! - 1), steps)}
          onNext={() => {
            if (step! + 1 < steps.length) goTo(step! + 1, steps);
            else if (unplaced.length) {
              setStep(steps.length);
              Haptics.selectionAsync().catch(() => {});
            } else close();
          }}
          moments={compareMoments(current)}
          moment={moment ?? seekTimeFor(current)}
          onMoment={(m) => {
            if (!player) return;
            p.onPause();
            seekTo(player, m.t);
            setT(m.t);
            setMoment(m.t);
            Haptics.selectionAsync().catch(() => {});
          }}
          onPlay={() => {
            if (!player) return;
            setMoment(null);
            // Replay from a beat before the tell so the change is visible.
            if (p.paused) seekTo(player, Math.max(0, current.t0 - 1));
            if (p.paused) p.onPlay();
            else p.onPause();
          }}
        />
      )}

      {onSummary && (
        <AlsoClaimed
          claims={unplaced}
          position={`Step ${count} of ${count}`}
          onPrev={steps.length ? () => goTo(steps.length - 1, steps) : undefined}
          onDone={close}
        />
      )}

      <Pressable
        onPress={step === null ? open : close}
        style={({ pressed }) => [styles.pill, { top: p.top }, step !== null && styles.pillOn, pressed && styles.pressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={step === null ? 'Reveal AI tells' : 'Close the walkthrough'}
      >
        <Ionicons name={step === null ? 'scan-outline' : 'close'} size={15} color={step === null ? '#fff' : '#111'} />
        <Text style={[styles.pillText, step !== null && styles.pillTextOn]}>
          {step === null ? 'Reveal AI tells' : step === -1 ? 'No tells found' : 'Close'}
        </Text>
      </Pressable>
    </>
  );
}

/** Closing card: claims from the note or comments that can't be shown on the video. */
function AlsoClaimed(props: { claims: UnplacedClaim[]; position: string; onPrev?: () => void; onDone: () => void }) {
  return (
    <View style={[styles.card, { bottom: 16 }]} accessibilityLiveRegion="polite">
      <View style={styles.cardHead}>
        <Text style={styles.position}>{props.position}</Text>
        <View style={[styles.status, styles.statusDraft]}>
          <Ionicons name="help-circle-outline" size={12} color={ACCENT} />
          <Text style={[styles.statusText, { color: ACCENT }]}>Not shown on video</Text>
        </View>
      </View>
      <Text style={styles.title}>Also claimed</Text>
      {props.claims.slice(0, 4).map((c, i) => (
        <Text key={i} style={styles.detail} numberOfLines={2}>
          “{c.quote}” <Text style={styles.source}>· {c.from === 'community_note' ? 'Community Note' : `Comment${c.author ? ` by @${c.author}` : ''}`}</Text>
        </Text>
      ))}
      <Text style={styles.caveat}>{"No time was given and the model couldn't find these in the frames. They may be true, or not."}</Text>
      <View style={styles.actions}>
        <CardButton icon="chevron-back" label="Back" onPress={props.onPrev ?? (() => {})} disabled={!props.onPrev} />
        <CardButton icon="checkmark" label="Done" onPress={props.onDone} primary trailing />
      </View>
    </View>
  );
}

/** Reports playback time; a component so the listener only exists while there's a player. */
function PlayerClock({ player, onTime }: { player: VideoPlayer; onTime: (t: number) => void }) {
  useEventListener(player, 'timeUpdate', (e) => onTime(e.currentTime));
  return null;
}

/** Darkens everything but the box. */
function Spotlight({ rect: r, stageW, stageH }: { rect: Box; stageW: number; stageH: number }) {
  return (
    <>
      <View style={[styles.scrim, { left: 0, top: 0, width: stageW, height: r.y }]} />
      <View style={[styles.scrim, { left: 0, top: r.y + r.h, width: stageW, height: stageH - r.y - r.h }]} />
      <View style={[styles.scrim, { left: 0, top: r.y, width: r.x, height: r.h }]} />
      <View style={[styles.scrim, { left: r.x + r.w, top: r.y, width: stageW - r.x - r.w, height: r.h }]} />
    </>
  );
}

function StepCard(props: {
  tell: Tell;
  index: number;
  count: number;
  paused: boolean;
  style: object;
  moments: [Moment, Moment] | null;
  /** Time of the moment shown now. */
  moment: number;
  onMoment: (m: Moment) => void;
  onPrev: () => void;
  onNext: () => void;
  onPlay: () => void;
}) {
  const { tell, index, count } = props;
  const copy = stepCopy(tell, index, count);
  const last = index + 1 >= count;
  return (
    <View style={[styles.card, props.style]} accessibilityLiveRegion="polite">
      <View style={styles.cardHead}>
        <Text style={styles.position}>{copy.position}</Text>
        <View style={[styles.status, copy.unverified ? styles.statusDraft : styles.statusChecked]}>
          <Ionicons name={copy.unverified ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={12} color={copy.unverified ? ACCENT : CHECKED} />
          <Text style={[styles.statusText, { color: copy.unverified ? ACCENT : CHECKED }]}>{copy.status}</Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {tell.label}
      </Text>
      {tell.detail ? (
        <Text style={styles.detail} numberOfLines={3}>
          {tell.detail}
        </Text>
      ) : null}
      <Text style={styles.source} numberOfLines={2}>
        {tell.evidence ? `“${tell.evidence.quote}” · ${copy.source}` : copy.source}
      </Text>
      {copy.caveat ? <Text style={styles.caveat}>{copy.caveat}</Text> : null}
      {props.moments && (
        <View style={styles.segment} accessibilityRole="tablist">
          {props.moments.map((m) => {
            const on = props.paused && Math.abs(props.moment - m.t) < 0.05;
            return (
              <Pressable
                key={m.label}
                onPress={() => props.onMoment(m)}
                style={[styles.segBtn, on && styles.segOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${m.label}, ${m.t.toFixed(1)} seconds`}
              >
                <Text style={[styles.segText, on && styles.segTextOn]}>
                  {m.label} · {m.t.toFixed(1)}s
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={styles.actions}>
        <CardButton icon="chevron-back" label="Back" onPress={props.onPrev} disabled={index === 0} />
        <CardButton icon={props.paused ? 'play' : 'pause'} label={props.paused ? 'Play' : 'Pause'} onPress={props.onPlay} />
        <CardButton icon={last ? 'checkmark' : 'chevron-forward'} label={last ? 'Done' : 'Next'} onPress={props.onNext} primary trailing />
      </View>
    </View>
  );
}

function CardButton(props: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  trailing?: boolean;
}) {
  const color = props.primary ? '#111' : '#fff';
  const icon = <Ionicons name={props.icon} size={16} color={color} />;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [styles.btn, props.primary && styles.btnPrimary, props.disabled && styles.btnDisabled, pressed && styles.pressed]}
    >
      {!props.trailing && icon}
      <Text style={[styles.btnText, { color }]}>{props.label}</Text>
      {props.trailing && icon}
    </Pressable>
  );
}

const ACCENT = '#FFD60A';
const CHECKED = '#5BE38C';
const LABEL_H = 28;
const LABEL_MAX_W = 240;

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pillOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  pressed: { opacity: 0.7 },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pillTextOn: { color: '#111' },
  scrim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.5)' },
  box: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: ACCENT,
    borderRadius: 8,
    backgroundColor: 'rgba(255,214,10,0.08)',
  },
  boxDim: { borderColor: 'rgba(255,214,10,0.55)', borderWidth: 1.5, backgroundColor: 'transparent' },
  label: {
    position: 'absolute',
    maxWidth: LABEL_MAX_W,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  labelText: { color: '#111', fontSize: 12, fontWeight: '700' },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 14,
    gap: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(16,16,18,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  statusDraft: { borderColor: 'rgba(255,214,10,0.6)' },
  statusChecked: { borderColor: 'rgba(91,227,140,0.6)' },
  statusText: { fontSize: 11, fontWeight: '700' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  detail: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 19 },
  source: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontStyle: 'italic' },
  caveat: { color: ACCENT, fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  segment: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 2 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  segOn: { backgroundColor: 'rgba(255,255,255,0.92)' },
  segText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  segTextOn: { color: '#111' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  btnPrimary: { backgroundColor: ACCENT },
  btnDisabled: { opacity: 0.35 },
  btnText: { fontSize: 14, fontWeight: '600' },
});
