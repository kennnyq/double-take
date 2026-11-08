import { GameFrame } from '@/game/GameFrame';
import { GameRound } from '@/game/GameRound';

/** The timed round (30 s by default; the demo): mark AI clips, skip real ones. Started from Dev settings → Game; the app's rail or tab bar stays around it. */
export default function GameScreen() {
  return (
    <GameFrame>
      <GameRound />
    </GameFrame>
  );
}
