import { Redirect } from 'expo-router';
import { View } from 'react-native';

/** Dev builds: the timed round's designs side by side (filled in by the game lab). */
export default function GameLabScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <View />;
}
