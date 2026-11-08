import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';

export default function RootLayout() {
  useEffect(() => {
    // No audio mode here: expo-video owns the iOS audio session. Its default
    // ('auto') plays through the silent switch and pauses other apps only while
    // a clip is heard. Setting the session from expo-audio as well had two
    // modules rewriting it on different threads as clips played and muted.
    // iPhone stays portrait; iPad rotates freely.
    if (Platform.OS === 'ios' && !Platform.isPad) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
        {/* The phone's Settings tab: no slide or swipe-back, so it behaves like the other tabs. */}
        <Stack.Screen name="settings" options={{ animation: 'none', gestureEnabled: false }} />
      </Stack>
    </>
  );
}
