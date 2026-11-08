import type { VideoPlayer } from 'expo-video';

type TimeListener = (event: { currentTime: number }) => void;

/**
 * The slice of expo-video's `VideoPlayer` that the tells walkthrough uses
 * (duration, seeking, the time-update rate and `timeUpdate` events), backed by
 * a plain `<video>` element. The desktop feed plays clips in its own pool of
 * `<video>` elements, and this lets it host the same `TellOverlay` as the app.
 */
export class HtmlVideoPlayer {
  private el: HTMLVideoElement | null = null;
  private listeners = new Set<TimeListener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private interval = 0.25;

  attach(el: HTMLVideoElement | null): void {
    this.el = el;
  }

  /** The <video> itself (the double take's cheap blur draws a still from it). */
  get element(): HTMLVideoElement | null {
    return this.el;
  }

  get duration(): number {
    const d = this.el?.duration;
    return d && Number.isFinite(d) ? d : 0;
  }

  get currentTime(): number {
    return this.el?.currentTime ?? 0;
  }

  set currentTime(seconds: number) {
    if (this.el) this.el.currentTime = seconds;
  }

  get timeUpdateEventInterval(): number {
    return this.interval;
  }

  set timeUpdateEventInterval(seconds: number) {
    this.interval = seconds;
    this.restart();
  }

  /** Same shape as expo's event emitters, so `useEventListener(player, 'timeUpdate', …)` works. */
  addListener(event: string, listener: TimeListener): { remove: () => void } {
    if (event !== 'timeUpdate') return { remove: () => {} };
    this.listeners.add(listener);
    this.restart();
    return {
      remove: () => {
        this.listeners.delete(listener);
        this.restart();
      },
    };
  }

  /** For components typed against expo-video that only use the slice above. */
  asVideoPlayer(): VideoPlayer {
    return this as unknown as VideoPlayer;
  }

  private restart(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.listeners.size || this.interval <= 0) return;
    this.timer = setInterval(() => {
      const currentTime = this.currentTime;
      this.listeners.forEach((l) => l({ currentTime }));
    }, this.interval * 1000);
  }
}
