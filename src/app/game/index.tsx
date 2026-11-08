import { GameFrame } from '@/game/GameFrame';
import { GameRound } from '@/game/GameRound';

/** A 60 s round: mark AI clips, skip real ones. Started from Settings; the app's rail or tab bar stays around it. */
export default function GameScreen() {
  return (
    <GameFrame>
      <GameRound />
    </GameFrame>
  );
}
