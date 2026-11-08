/**
 * The clips the features section shows: a real clip from the feed with its
 * tells for the walkthrough (one tells request, made only when the section
 * comes near), and a few more from the same feed for the other sections.
 * Without tells (no API, a clip without any), it walks through stand-in
 * steps on whatever clip there is.
 */
import type { Clip } from '@/data/clips';
import { loadInitialClips } from '@/data/feed';
import { heroCandidates, rankClips, type RankableClip } from '@/data/rank';
import { mediaUri } from '@/desktop/media';
import { readTellsFile, type Box, type Tell } from '@/annotations/format';
import { replayWindow, seekTimeFor, walkthroughSteps, type Replay } from '@/annotations/walkthrough';
import { videoRect } from '@/feed/tells';

export interface DemoStep {
  /** The tell's box, as fractions of the video frame; none for a tell with no place. */
  box: Box | null;
  /** Where the step pauses, and the slow-motion loop around it (clip seconds). */
  focus: number;
  replay: Replay;
  /** The card's words. */
  text: string;
  /** "0:03" */
  time: string;
  /** The tell's short label. */
  label: string;
}

export interface DemoClip {
  video: string;
  poster?: string;
  /** Width / height (9:16 when unknown). */
  aspect: number;
  author: string;
  caption: string;
  steps: DemoStep[];
}

export interface DemoMedia {
  /** The walkthrough's clip. */
  walk: DemoClip;
  /** Other portrait clips, for the feed before it and the other sections. */
  others: (RankableClip & { video: string; poster?: string; author: string; caption: string; verdict?: 'ai' | 'real'; evidence?: string })[];
}

const PORTRAIT = 9 / 16;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function toStep(t: Tell): DemoStep {
  return {
    box: t.box ?? null,
    focus: seekTimeFor(t),
    replay: replayWindow(t),
    text: t.detail ?? t.label,
    label: t.label,
    time: clock(seekTimeFor(t)),
  };
}

/** Stand-in steps when no clip has tells: places a viewer would look, in the app's words. */
const STAND_IN: { box: Box; at: number; text: string; label: string }[] = [
  { box: { x: 0.3, y: 0.22, w: 0.4, h: 0.2 }, at: 1.2, label: 'Face', text: 'Watch the face as it turns: the features slide for a few frames.' },
  { box: { x: 0.18, y: 0.55, w: 0.34, h: 0.18 }, at: 2.6, label: 'Hands', text: 'The fingers merge into each other as the hand moves.' },
  { box: { x: 0.52, y: 0.62, w: 0.32, h: 0.16 }, at: 4, label: 'Text', text: 'The sign behind them almost spells something, then changes.' },
  { box: { x: 0.12, y: 0.12, w: 0.5, h: 0.16 }, at: 5.2, label: 'Light', text: 'The shadow falls the wrong way for where the light is.' },
];

function standIn(): DemoStep[] {
  return STAND_IN.map((s) => ({
    box: s.box,
    focus: s.at,
    replay: { from: Math.max(0, s.at - 0.6), to: s.at + 0.8 },
    text: s.text,
    label: s.label,
    time: clock(s.at),
  }));
}

async function tellsOf(clip: Clip): Promise<Tell[]> {
  if (!clip.tellsUrl) return [];
  try {
    const res = await fetch(clip.tellsUrl);
    if (!res.ok) return [];
    return walkthroughSteps(readTellsFile(await res.json()).tells).filter((t) => t.box);
  } catch {
    return [];
  }
}

const portrait = (c: Clip) => c.aspect === undefined || c.aspect < 0.75;

let pending: Promise<DemoMedia> | null = null;

/** The section's clips (once per page: the clips come from the request the feed makes anyway). */
export function loadDemo(): Promise<DemoMedia> {
  pending ??= (async () => {
    const clips = await loadInitialClips();
    const tall = clips.filter(portrait);
    // The first AI clip (of a few) with at least two placed tells.
    let walk: DemoClip | null = null;
    let used: Clip | null = null;
    for (const c of heroCandidates(tall.filter((c) => c.verdict === 'ai' && c.tellsUrl), 3, { minimum: 0 })) {
      const tells = await tellsOf(c);
      if (tells.length >= 2) {
        used = c;
        walk = { ...base(c), steps: tells.slice(0, 4).map(toStep) };
        break;
      }
    }
    if (!walk) {
      used = tall.find((c) => c.verdict === 'ai') ?? tall[0] ?? clips[0];
      walk = { ...base(used), steps: standIn() };
    }
    const others = rankClips(tall)
      .filter((c) => c !== used)
      .slice(0, 12)
      .map((c) => ({ ...c, video: mediaUri(c.video) ?? '', poster: mediaUri(c.poster), author: c.author, caption: c.caption, verdict: c.verdict, evidence: c.verdictEvidence }));
    return { walk, others };
  })();
  return pending;
}

function base(c: Clip): Omit<DemoClip, 'steps'> {
  return { video: mediaUri(c.video) ?? '', poster: mediaUri(c.poster), aspect: c.aspect ?? PORTRAIT, author: c.author, caption: c.caption };
}

/** Where a box (fractions of the frame) lands on a `w`×`h` screen showing the video `cover`ed, as the feed does. */
export function boxOnScreen(box: Box, aspect: number, w: number, h: number): Box {
  const f = videoRect(w, h, aspect, 'cover');
  return { x: f.x + box.x * f.w, y: f.y + box.y * f.h, w: box.w * f.w, h: box.h * f.h };
}
