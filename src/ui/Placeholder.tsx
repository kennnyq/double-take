import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function Placeholder({ title, icon }: { title: string; icon: React.ComponentProps<typeof Ionicons>['name'] }) {
  return (
    <View style={styles.root}>
      <View style={styles.circle}>
        <Ionicons name={icon} size={36} color="#fff" />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>Coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  circle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  sub: { color: '#a8a8a8', fontSize: 15, textAlign: 'center' },
});
