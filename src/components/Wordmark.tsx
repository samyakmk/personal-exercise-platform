import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { color } from '../theme';
import { Display } from './ui';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <View aria-hidden style={styles.wordmark}>
    <Svg width={37} height={37} viewBox="0 0 48 48">
      <Circle cx={24} cy={24} r={23} stroke={color.accent} strokeWidth={1.5} fill={color.ink} />
      <Path d="M12 15h16M20 15v18m7-9h10m-5-5v10"
        stroke={color.accent} strokeWidth={3} strokeLinecap="round" fill="none" />
    </Svg>
    {!compact && <Display size={24} tone={color.surface} style={styles.name}>Trainer Plus</Display>}
  </View>;
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { letterSpacing: -0.9 },
});
