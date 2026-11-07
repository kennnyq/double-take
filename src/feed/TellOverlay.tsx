import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import { Ionicons } from '@expo/vector-icons';
import { activeTells, boxOnStage, parseTells, revealTime, videoRect, type Fit, type Tell } from './tells';

interface Props {
  /** Signed URL of the clip's tells JSON. */
  url: string;
  player: VideoPlayer | null;
  stageW: number;
  stageH: number;
  aspect: number;
  fit: Fit;
  /** Distance of the reveal button from the top of the stage. */
  top: number;
}

async function loadTells(url: string): Promise<Tell[]> {
  try {
    const res = await fetch(url); // signed URL, so no auth header
    return res.ok ? parseTells(await res.json()) : [];
  } catch {
    return [];
  }
}

/** Seeking is a property write on the player; kept out of the component body. */
function seekTo(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
}

/**
 * "Reveal" for clips with known tells: a button that, once tapped, outlines
 * each giveaway on the video while it is on screen and jumps to the first one.
 * Boxes track the same contain/cover transform as the video. Mounted only for
 * the active clip, so every visit starts unrevealed. Play/pause stays with the
 * feed, so a paused clip holds on the tell's frame.
 */
export function TellOverlay(p: Props) {
  const [revealed, setRevealed] = useState(false);
  const [tells, setTells] = useState<Tell[] | null>(null);

  const toggle = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    setRevealed(true);
    let list = tells;
    if (!list) {
      list = await loadTells(p.url);
      setTells(list);
    }
    if (list.length && p.player) seekTo(p.player, revealTime(list));
  };

  const count = tells?.length;
  return (
    <>
      {revealed && p.player && tells && tells.length > 0 && <Boxes {...p} player={p.player} tells={tells} />}
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.pill, { top: p.top }, revealed && styles.pillOn, pressed && styles.pressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={revealed ? 'Hide AI tells' : 'Reveal AI tells'}
      >
        <Ionicons name={revealed ? 'eye-off-outline' : 'scan-outline'} size={15} color={revealed ? '#111' : '#fff'} />
        <Text style={[styles.pillText, revealed && styles.pillTextOn]}>
          {revealed ? (count === 0 ? 'No tells found' : `Hide tells${count ? ` · ${count}` : ''}`) : 'Reveal AI tells'}
        </Text>
      </Pressable>
    </>
  );
}

function Boxes(p: Props & { player: VideoPlayer; tells: Tell[] }) {
  const [t, setT] = useState(() => p.player.currentTime);
  useEventListener(p.player, 'timeUpdate', (e) => setT(e.currentTime));
  const frame = videoRect(p.stageW, p.stageH, p.aspect, p.fit);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {activeTells(p.tells, t).map((tell) => {
        const r = boxOnStage(tell.box, frame, p.stageW, p.stageH);
        if (!r) return null;
        // Above the box when that clears the top bar, otherwise inside its bottom
        // edge; anchored to whichever side of the box keeps it on screen.
        const labelAbove = r.y - LABEL_H > p.top + 36;
        const anchorRight = r.x + LABEL_MAX_W > p.stageW;
        return (
          <View key={tell.id} style={[styles.box, { left: r.x, top: r.y, width: r.w, height: r.h }]}>
            <View
              style={[
                styles.label,
                labelAbove ? styles.labelAbove : styles.labelInside,
                anchorRight ? styles.labelRight : styles.labelLeft,
              ]}
            >
              <Text style={styles.labelText} numberOfLines={2}>
                {tell.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const ACCENT = '#FFD60A';
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
  box: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: ACCENT,
    borderRadius: 8,
    backgroundColor: 'rgba(255,214,10,0.10)',
  },
  label: {
    position: 'absolute',
    maxWidth: LABEL_MAX_W,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  labelAbove: { bottom: '100%', marginBottom: 4 },
  labelInside: { bottom: 4 },
  labelLeft: { left: -2.5 },
  labelRight: { right: -2.5 },
  labelText: { color: '#111', fontSize: 12, fontWeight: '700' },
});
