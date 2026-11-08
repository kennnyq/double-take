/**
 * How much the landing asks of the device. Phones (small screens with touch)
 * and slow machines get a lighter landing with the same look: whole strips
 * leave at the launch instead of each tile on its own canvas, the sink is
 * flat, no backdrop blur, and fewer, slower-redrawn swipes. Chosen by what the
 * device can do, not its user agent; the `tier` design on trial can force one.
 */
export type Tier = 'full' | 'phone';

export interface Device {
  /** The screen's shorter side, CSS px. */
  shortSide: number;
  /** Whether the main pointer is coarse (a finger). */
  coarse: boolean;
  /** navigator.hardwareConcurrency, when known. */
  cores?: number;
  /** navigator.deviceMemory (GB), when known (Chromium only). */
  memory?: number;
}

export function pickTier(device: Device, knob: 'auto' | Tier = 'auto'): Tier {
  if (knob !== 'auto') return knob;
  if (device.coarse && device.shortSide <= 600) return 'phone';
  if (device.cores !== undefined && device.cores <= 4) return 'phone';
  if (device.memory !== undefined && device.memory <= 3) return 'phone';
  return 'full';
}

/** Swipes on the light tier: at most this many at once, their frames redrawn at most this often (ms). */
export const PHONE_SWIPES = { concurrent: 3, frameMs: 33 };
