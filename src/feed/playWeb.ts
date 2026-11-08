import type { VideoPlayer } from 'expo-video';

/** expo-video's web player keeps the `<video>` elements showing it here. */
type WebPlayer = { _mountedVideos?: Set<HTMLVideoElement> };

/**
 * Web: play the player's `<video>` elements and catch the browser refusing to
 * play with sound (`NotAllowedError`, e.g. iOS Safari outside a tap), which
 * expo-video's `play()` drops on the floor. `onBlocked` should mute the
 * player; playback is then retried muted. Falls back to `play()` if the
 * elements aren't reachable.
 */
export function playWeb(player: VideoPlayer, onBlocked: () => void): void {
  const videos = (player as unknown as WebPlayer)._mountedVideos;
  if (!videos) {
    player.play();
    return;
  }
  videos.forEach((v) => {
    v.play().catch((err: unknown) => {
      if ((err as { name?: string } | null)?.name !== 'NotAllowedError' || v.muted) return;
      onBlocked();
      v.muted = true;
      v.play().catch(() => {});
    });
  });
}
