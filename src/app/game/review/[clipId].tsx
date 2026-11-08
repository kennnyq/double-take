import { Redirect, useLocalSearchParams } from 'expo-router';
import { ReviewPlayer } from '@/game/ReviewPlayer';
import { wrongGuesses } from '@/game/score';
import { useFinishedRound } from '@/game/store';

/** One missed clip from the last round, replayed with what it really was. */
export default function ReviewScreen() {
  const { clipId } = useLocalSearchParams<{ clipId: string }>();
  const done = useFinishedRound();
  // A reload loses the round: start a new one.
  if (!done) return <Redirect href="/game" />;
  const misses = wrongGuesses(done.round.guesses);
  const i = misses.findIndex((g) => g.clipId === clipId);
  const clip = done.clips.get(clipId);
  if (i < 0 || !clip) return <Redirect href="/game/results" />;
  return <ReviewPlayer key={clipId} clip={clip} guess={misses[i]} prev={misses[i - 1]?.clipId} next={misses[i + 1]?.clipId} />;
}
