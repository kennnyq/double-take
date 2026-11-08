/**
 * Stand-ins for the Game and Skills tabs (on `feat/timed-guessing`, not merged
 * yet). The features section draws them from these shapes only, so once that
 * branch lands they can come from the real modules instead:
 *
 *  - `GAME_ROUND`: the round's answers → `src/game/round.ts` (a round's
 *    verdicts) and `src/game/history.ts`.
 *  - `SKILLS`: the scores → `src/skills/skill.ts` (`toScore`, `generalSkill`)
 *    over `src/skills/categories.ts`'s CATEGORY_INFO labels.
 *
 * Pure, so it runs under `node --test`.
 */

export interface GameAnswer {
  /** What the clip really is. */
  truth: 'ai' | 'real';
  /** What the player said. */
  call: 'ai' | 'real';
  /** The feedback's second line, when the clip has no evidence of its own. */
  why: string;
}

/** The player's calls in the round shown: both marked as AI (the second is real where the feed has a real clip). */
export const GAME_CALLS: GameAnswer['call'][] = ['ai', 'ai'];

/** An answer from what the clip really is (its verdict) and the call; the evidence, where the clip has it. */
export function answer(truth: GameAnswer['truth'], call: GameAnswer['call'], evidence?: string): GameAnswer {
  if (truth === 'real') return { truth, call, why: evidence || 'Filmed, not generated.' };
  return { truth, call, why: 'Step through what gave it away.' };
}

export function isRight(a: GameAnswer): boolean {
  return a.truth === a.call;
}

export interface SkillRow {
  label: string;
  /** The score now (0–100, 50 is guessing) and before the last round. */
  score: number;
  before: number;
  /** The uncertainty band around it. */
  low: number;
  high: number;
}

export interface SkillsMock {
  general: { score: number; before: number; low: number; high: number };
  rows: SkillRow[];
}

/** The categories the Skills tab shows, with its labels (CATEGORY_INFO's). */
export const SKILLS: SkillsMock = {
  general: { score: 68, before: 62, low: 61, high: 74 },
  rows: [
    { label: 'Visuals', score: 74, before: 66, low: 66, high: 81 },
    { label: 'Bodies', score: 63, before: 60, low: 52, high: 73 },
    { label: 'Text', score: 81, before: 71, low: 70, high: 89 },
    { label: 'Marks', score: 57, before: 57, low: 41, high: 72 },
    { label: 'Real', score: 66, before: 61, low: 58, high: 74 },
  ],
};

/** A tab as the app's tab bar lists it (`src/ui/TabBar.tsx`'s TABS). */
export interface ShowcaseTab {
  id: string;
  label: string;
  icon: string;
  iconActive: string;
}

/**
 * The tabs the showcase's phone shows: the app's own, with Game and Skills
 * standing in until `feat/timed-guessing` adds them (that branch's tab bar:
 * Home, Game, Skills, Create, You; Settings moves into You). Once the app's
 * tabs have a Game tab, they're shown exactly as they are.
 */
export function showcaseTabs<T extends ShowcaseTab>(tabs: readonly T[]): ShowcaseTab[] {
  if (tabs.some((t) => t.id === 'game')) return [...tabs];
  const home = tabs.filter((t) => t.id === 'home');
  const rest = tabs.filter((t) => t.id !== 'home' && t.id !== 'settings');
  return [
    ...home,
    { id: 'game', label: 'Game', icon: 'game-controller-outline', iconActive: 'game-controller' },
    { id: 'skills', label: 'Skills', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
    ...rest,
  ];
}
