import { StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { avatarHue } from '@/data/clips';

/** Initial-letter gradient avatar used for every person in the app. */
export function Avatar({ name, size }: { name: string; size: number }) {
  const hue = avatarHue(name);
  return (
    <LinearGradient
      colors={[`hsl(${hue}, 70%, 55%)`, `hsl(${(hue + 60) % 360}, 70%, 40%)`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.text, { fontSize: Math.max(11, Math.round(size * 0.4)) }]}>{name[0].toUpperCase()}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  text: { color: '#fff', fontWeight: '700' },
});
