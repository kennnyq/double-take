import { Redirect } from 'expo-router';
import { useGameDesigns } from '@/game/devOptions';
import { GameFrame } from '@/game/GameFrame';
import { Results } from '@/game/results/Results';
import { useFinishedRound } from '@/game/store';

/** After a round: the score, and every clip of the round revealed right or wrong. */
export default function ResultsScreen() {
  const done = useFinishedRound();
  const designs = useGameDesigns();
  // A reload loses the round: start a new one.
  if (!done) return <Redirect href="/game" />;
  return (
    <GameFrame>
      <Results done={done} designs={designs} />
    </GameFrame>
  );
}
