import { Redirect } from 'expo-router';
import { Results } from '@/game/Results';
import { useFinishedRound } from '@/game/store';

/** After a round: the score and a gallery of the wrong guesses. */
export default function ResultsScreen() {
  const done = useFinishedRound();
  // A reload loses the round: start a new one.
  if (!done) return <Redirect href="/game" />;
  return <Results done={done} />;
}
