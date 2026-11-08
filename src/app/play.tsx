import { GameFrame } from '@/game/GameFrame';
import { GameRound } from '@/game/GameRound';

/**
 * The Game tab: the untimed game, clip after clip in the feed, every answer
 * going to Your skills (the Skills tab beside it). Its own route, pushed over
 * Home without animation like the other route tabs.
 */
export default function PlayScreen() {
  return (
    <GameFrame tab="game">
      <GameRound timed={false} />
    </GameFrame>
  );
}
