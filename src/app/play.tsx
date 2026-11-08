import { useLocalSearchParams } from 'expo-router';
import { GameFrame } from '@/game/GameFrame';
import { GameRound } from '@/game/GameRound';
import { SKILL_CATEGORIES, type SkillCategory } from '@/skills/categories';

/**
 * The Game tab: the untimed game, clip after clip in the feed, every answer
 * going to Your skills (the Skills tab beside it). Its own route, pushed over
 * Home without animation like the other route tabs. `?focus=<skill>` (from
 * Your skills' Practise button) deals more clips of that skill.
 */
export default function PlayScreen() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const skill = SKILL_CATEGORIES.includes(focus as SkillCategory) ? (focus as SkillCategory) : undefined;
  return (
    <GameFrame tab="game">
      <GameRound key={skill ?? 'all'} timed={false} focus={skill} />
    </GameFrame>
  );
}
