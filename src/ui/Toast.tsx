import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { tabBarHeight } from './TabBar';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface ToastSpec {
  icon?: IconName;
  text: string;
  action?: { label: string; onPress: () => void };
}

interface ToastApi {
  show: (toast: ToastSpec) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, hide: () => {} });
export const useToast = () => useContext(ToastContext);

const VISIBLE_MS = 2500;

/** One toast at a time, bottom-centred just above the tab bar. Renders above its children. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { key: number }) | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const insets = useSafeAreaInsets();

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setToast(null);
      },
    );
  }, [anim]);

  const show = useCallback(
    (t: ToastSpec) => {
      clearTimeout(timer.current);
      setToast({ ...t, key: Date.now() });
      anim.stopAnimation();
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      timer.current = setTimeout(hide, VISIBLE_MS);
    },
    [anim, hide],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show, hide }), [show, hide]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <View style={[styles.host, { bottom: tabBarHeight(insets.bottom) + 10 }]} pointerEvents="box-none">
          <Animated.View
            key={toast.key}
            style={[styles.card, { opacity: anim, transform: [{ translateY }] }]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {toast.icon && <Ionicons name={toast.icon} size={22} color="#fff" />}
            <Text style={styles.text} numberOfLines={2}>
              {toast.text}
            </Text>
            {toast.action && (
              <Pressable
                onPress={() => {
                  toast.action?.onPress();
                  hide();
                }}
                hitSlop={10}
                accessibilityRole="button"
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={styles.action}>{toast.action.label}</Text>
              </Pressable>
            )}
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(38,38,38,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
  },
  text: { flex: 1, color: '#fff', fontSize: 15 },
  action: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
