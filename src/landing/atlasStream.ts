/**
 * Plays the gallery atlas as one endless Media Source timeline: the same
 * fragment appended again and again, each copy right after the last, so the
 * video never wraps. A `<video loop>` seeks back to 0 as it wraps and holds
 * its last frame 83-100 ms instead of 67 (measured in Chrome), a hitch every
 * loop; Safari's is longer.
 */

/** A fragmented MP4 cut into what Media Source wants: the init boxes, then the media boxes. */
export interface Fragmented {
  init: Uint8Array<ArrayBuffer>;
  media: Uint8Array<ArrayBuffer>;
}

/**
 * Splits a fragmented MP4 (`ftyp`, `moov`, then `moof`/`mdat` pairs) at its
 * top-level boxes. Boxes after the media (an `mfra` index) are left out, so
 * the media can be appended back to back. Null when it isn't fragmented.
 */
export function splitFragmented(bytes: Uint8Array<ArrayBuffer>): Fragmented | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let mediaStart = -1;
  let mediaEnd = -1;
  while (at + 8 <= bytes.length) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (size === 1) {
      if (at + 16 > bytes.length) return null;
      size = Number(view.getBigUint64(at + 8));
    } else if (size === 0) size = bytes.length - at;
    if (size < 8 || at + size > bytes.length) return null;
    if (type === 'moof' || type === 'mdat') {
      if (mediaStart < 0) {
        if (type !== 'moof') return null;
        mediaStart = at;
      }
      mediaEnd = at + size;
    } else if (mediaStart >= 0) break;
    at += size;
  }
  if (mediaStart <= 0) return null;
  return { init: bytes.subarray(0, mediaStart), media: bytes.subarray(mediaStart, mediaEnd) };
}

/**
 * What to do with the buffer at playback time `t`: append the next copy once
 * less than `ahead` seconds are left, and drop whole copies that are behind
 * (only whole ones: removing part of one would take the frames after it that
 * depend on its keyframe with it).
 */
export function loopPlan(t: number, copies: number, loop: number, bufferedStart: number | null, ahead = loop * 1.5) {
  const current = Math.floor(t / loop) * loop;
  const dropTo = bufferedStart !== null && current - bufferedStart >= loop ? current : null;
  return { append: copies * loop - t < ahead, offset: copies * loop, dropTo };
}

type MediaSourceCtor = typeof MediaSource;

/**
 * Feeds `video` the atlas as an endless timeline. Returns false where Media
 * Source can't play it (the caller then falls back to `loop`). iPhones only
 * have ManagedMediaSource (iOS 17.1+).
 */
export function streamLoop(video: HTMLVideoElement, bytes: Uint8Array<ArrayBuffer>, mime: string, loop: number): boolean {
  const w = window as Window & { ManagedMediaSource?: MediaSourceCtor; MediaSource?: MediaSourceCtor };
  const MS = w.ManagedMediaSource ?? w.MediaSource;
  const parts = splitFragmented(bytes);
  if (!MS || !parts || !MS.isTypeSupported(mime)) return false;
  const ms = new MS();
  // ManagedMediaSource only streams to a video that can't be AirPlayed away.
  if (MS === w.ManagedMediaSource) video.disableRemotePlayback = true;
  video.loop = false;
  video.src = URL.createObjectURL(ms);
  ms.addEventListener(
    'sourceopen',
    () => {
      URL.revokeObjectURL(video.src);
      const sb = ms.addSourceBuffer(mime);
      let copies = 0;
      const pump = () => {
        if (sb.updating || ms.readyState !== 'open') return;
        const start = sb.buffered.length ? sb.buffered.start(0) : null;
        const plan = loopPlan(video.currentTime, copies, loop, start);
        try {
          if (plan.dropTo !== null) sb.remove(0, plan.dropTo);
          else if (plan.append) {
            sb.timestampOffset = plan.offset;
            sb.appendBuffer(parts.media);
            copies++;
          }
        } catch {
          // Quota or a closed source: the next tick tries again.
        }
      };
      sb.addEventListener('updateend', pump);
      video.addEventListener('timeupdate', pump);
      sb.appendBuffer(parts.init);
    },
    { once: true },
  );
  return true;
}
