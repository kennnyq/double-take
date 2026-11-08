import { useEffect, useRef, useState, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import type { Clip } from '@/data/clips';
import { verdictWhy } from '@/data/remote';
import { cardSpot, estimateCardHeight } from '@/feed/card';
import { InfoCard } from '@/feed/InfoCard';
import { TellOverlay, type TellOverlayHandle } from '@/feed/TellOverlay';
import type { Fit } from '@/feed/tells';
import { VerdictBadge } from '@/feed/VerdictBadge';
import type { Verdict } from './round';

/** What the replay's player lets the explanation do (the double take drives it like the feed's clip). */
export interface ReplayControls {
  play: () => void;
  pause: () => void;
  /** Slow-motion, muted playback for the walkthrough's loops. */
  slowmo: (on: boolean) => void;
  /** A scrub is driving the player: held paused and muted meanwhile. */
  scrub: (on: boolean) => void;
  /** The walkthrough is showing: the clip shows its whole frame and the replay's own buttons step aside. */
  inspect: (on: boolean) => void;
}

/**
 * Why a clip from the round is what it is, over its replay. The results'
 * expand shows it once the clip has opened full size; this is the one place
 * the replay asks for an explanation.
 */
export interface ExplainerProps {
  clip: Clip;
  truth: Verdict;
  /** What the viewer did against what it was, e.g. "You skipped · AI". */
  label: string;
  /** The replay's player, already holding the clip. */
  player: VideoPlayer;
  controls: ReplayControls;
  paused: boolean;
  /** The replay's stage, and how its video is fitted right now. */
  stageW: number;
  stageH: number;
  fit: Fit;
  /** Space to leave clear at the top (the replay's buttons) and bottom. */
  top: number;
  bottom: number;
  /** The player can play: the walkthrough waits for it. */
  ready: boolean;
}

export type MissExplainer = ComponentType<ExplainerProps>;

/**
 * The double take, as the feed shows it: for a clip with tells, the
 * walkthrough opens by itself (the video scrubs to each tell, loops it slowly
 * under the spotlight, and a card resolves its reason); after its last step,
 * or straight away for a clip without tells (every real clip), a card
 * resolves why it was AI or real. The verdict stays in the corner throughout.
 */
export function DoubleTakeExplainer({ clip, truth, label, player, controls, paused, stageW, stageH, fit, top, bottom, ready }: ExplainerProps) {
  const tells = useRef<TellOverlayHandle>(null);
  const hasTells = !!clip.tellsVariants?.length;
  // 'walk': the walkthrough runs; 'why': the closing card shows.
  const [stage, setStage] = useState<'wait' | 'walk' | 'why'>(hasTells ? 'wait' : 'why');
  const walked = useRef(false);

  // Open the walkthrough once the clip can play (the feed opens it after the first frame too).
  useEffect(() => {
    if (!hasTells || !ready || walked.current) return;
    walked.current = true;
    const t = setTimeout(() => {
      setStage('walk');
      tells.current?.open();
    }, 250);
    return () => clearTimeout(t);
  }, [hasTells, ready]);

  const onInspect = (on: boolean) => {
    controls.inspect(on);
    // The walkthrough ended (its last step, or Close): the closing card follows.
    if (!on && walked.current) setStage('why');
  };

  const why = verdictWhy(clip);
  const title = truth === 'ai' ? 'Why it was AI' : 'Why it was real';
  const text = why ? `${title}: ${why}` : title;
  const width = Math.min(320, stageW - 24);
  const spot = cardSpot({ hole: null, placement: 'bottom', stageW, stageH, cardH: estimateCardHeight(text, width), safeTop: top + 46, safeBottom: bottom + 20 });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="miss-explanation-host">
      {hasTells && (
        <TellOverlay
          ref={tells}
          variants={clip.tellsVariants!}
          player={player}
          stageW={stageW}
          stageH={stageH}
          aspect={clip.aspect ?? 9 / 16}
          fit={fit}
          top={top}
          paused={paused}
          onPause={controls.pause}
          onPlay={controls.play}
          onSlowmo={controls.slowmo}
          onScrub={controls.scrub}
          onInspect={onInspect}
        />
      )}
      {/* In the top row, beside Close: clear of the walkthrough's cards. */}
      <View style={[styles.badge, { top: top + 6 }]} pointerEvents="none">
        <VerdictBadge verdict={truth} />
      </View>
      {stage === 'why' && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="miss-explanation" accessibilityLabel={`${text}. ${label}`}>
          <InfoCard spot={spot} stageH={stageH} text={text} hint={label} leaving={false} onGone={() => {}} />
        </View>
      )}
    </View>
  );
}

/** The explanation the replay shows: the double take's own presentation. */
export const MISS_EXPLAINER: MissExplainer = DoubleTakeExplainer;

const styles = StyleSheet.create({
  badge: { position: 'absolute', left: 58 },
});
