import { Redirect } from 'expo-router';
import { GameLab } from '@/game/lab/GameLab';

/** Dev builds only: the timed round's designs side by side, with fake states. */
export default function GameLabScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <GameLab />;
}
