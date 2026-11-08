import { GameFrame } from '@/game/GameFrame';
import { SkillsView } from '@/skills/SkillsView';

/**
 * The Skills tab: the player's skill scores. Its own route, pushed over Home
 * without animation like Settings, with the app's tab bar (phones) or rail
 * (desktop) around it.
 */
export default function SkillsScreen() {
  return (
    <GameFrame tab="skills">
      <SkillsView />
    </GameFrame>
  );
}
