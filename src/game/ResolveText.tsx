import { useEffect, useState } from 'react';
import { Animated, Easing, type StyleProp, type TextStyle } from 'react-native';
import { NATIVE, RESOLVE_MS, blurStyle, lerp } from './motion';

/**
 * Text that resolves the way the double take's info card does (Siri's
 * answers): from faint, slightly low and blurred to sharp, eased out, when
 * `on` turns true; it dissolves the same way back.
 */
export function ResolveText({ on, delay = 0, style, children, testID }: { on: boolean; delay?: number; style?: StyleProp<TextStyle>; children: React.ReactNode; testID?: string }) {
  const [v] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    const a = Animated.timing(v, {
      toValue: on ? 1 : 0,
      duration: RESOLVE_MS,
      delay: on ? delay : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    a.start();
    return () => a.stop();
  }, [v, on, delay]);
  return (
    <Animated.Text
      testID={testID}
      style={[
        style,
        { opacity: v, transform: [{ translateY: lerp(v, [0, 1], [10, 0]) }, { scale: lerp(v, [0, 1], [1.04, 1]) }] },
        blurStyle(lerp(v, [0, 1], [1, 0]), 12),
      ]}
    >
      {children}
    </Animated.Text>
  );
}
