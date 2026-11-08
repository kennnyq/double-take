import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { DocumentPickerAsset } from 'expo-document-picker';

/**
 * A playable address for a picked or dropped file. Browsers need an object URL
 * for a dropped File; `release` frees it once the preview is gone.
 */
export function previewSource(asset: DocumentPickerAsset): { uri: string; release: () => void } {
  if (Platform.OS === 'web' && asset.file && typeof URL.createObjectURL === 'function') {
    const uri = URL.createObjectURL(asset.file);
    return { uri, release: () => URL.revokeObjectURL(uri) };
  }
  return { uri: asset.uri, release: () => {} };
}

/**
 * The picked clip, playing muted on a loop and fitted inside its parent, like
 * the preview step of a post composer. Reports its duration so the step can
 * show it; `onFail` fires when the file can't be decoded here (the server may
 * still say why).
 */
export function ClipPreview({ uri, paused, onDuration, onFail }: { uri: string; paused: boolean; onDuration?: (s: number) => void; onFail?: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    const status = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onFail?.();
      if (status === 'readyToPlay' && player.duration > 0) onDuration?.(player.duration);
    });
    return () => status.remove();
  }, [player, onDuration, onFail]);
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  return <VideoView player={player} nativeControls={false} playsInline contentFit="contain" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />;
}
