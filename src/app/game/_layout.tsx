import { Stack } from 'expo-router';

/** The timed round, its results and replays: full screen, no headers. */
export default function GameLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' }, animation: 'fade' }} />;
}
