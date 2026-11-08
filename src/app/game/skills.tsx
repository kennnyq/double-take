import { GameFrame } from '@/game/GameFrame';
import { SkillsView } from '@/skills/SkillsView';

/** The player's skill scores, from the results or Settings. */
export default function SkillsScreen() {
  return (
    <GameFrame>
      <SkillsView />
    </GameFrame>
  );
}
