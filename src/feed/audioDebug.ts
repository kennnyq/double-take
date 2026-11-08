/**
 * Dev-only audio readout for the phone feed: one line per change, printed to
 * the Metro log, so an audio bug on a device can be read back afterwards.
 * Pure, so it runs under `node --test`.
 */

export interface PlayerSnapshot {
  slot: number;
  /** The clip index this slot holds (-1: none), and whether it's loaded. */
  index: number;
  loaded: boolean;
  active: boolean;
  muted: boolean;
  playing: boolean;
  volume: number;
  rate: number;
  status: string;
}

export interface AudioReadout {
  line: string;
  /** Anything that would sound wrong: doubled audio, or sound while muted. */
  problems: string[];
}

export function describeAudio(globalMuted: boolean, active: number, players: PlayerSnapshot[]): AudioReadout {
  const audible = players.filter((p) => p.playing && !p.muted && p.volume > 0);
  const problems: string[] = [];
  if (audible.length > 1) problems.push(`${audible.length} players audible (slots ${audible.map((p) => p.slot).join(',')})`);
  if (globalMuted && audible.length) problems.push(`muted, but slot ${audible[0].slot} is audible`);
  for (const p of audible) if (!p.active) problems.push(`slot ${p.slot} (#${p.index}) is audible but not the active clip`);
  for (const p of players) if (!p.active && p.playing) problems.push(`slot ${p.slot} (#${p.index}) plays off screen`);
  const slots = players.map(
    (p) =>
      `s${p.slot} #${p.index}${p.loaded ? '' : '(loading)'}${p.active ? '*' : ''} ` +
      `${p.playing ? 'play' : 'stop'} ${p.muted ? 'muted' : 'SOUND'} v${round(p.volume)} x${round(p.rate)} ${p.status}`,
  );
  return { line: `mute=${globalMuted ? 'on' : 'off'} active=#${active} | ${slots.join(' | ')}`, problems };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
