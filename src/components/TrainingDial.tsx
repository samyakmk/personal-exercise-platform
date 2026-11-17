import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { color } from '../theme';

const ticks = Array.from({ length: 60 }, (_, i) => {
  const angle = (i / 60) * 2 * Math.PI;
  const inner = i % 5 === 0 ? 152 : 157;
  return {
    x1: 226 + inner * Math.sin(angle), y1: 203 - inner * Math.cos(angle),
    x2: 226 + 162 * Math.sin(angle), y2: 203 - 162 * Math.cos(angle),
  };
});

export function TrainingDial({ compact = false }: { compact?: boolean }) {
  return <View pointerEvents="none" aria-hidden style={[styles.dial, compact && styles.compact]}>
    <Svg width="100%" height="100%" viewBox="0 0 420 400">
      <Circle cx={226} cy={203} r={180} fill="none" stroke={color.onInk} strokeOpacity={0.19} />
      <Circle cx={226} cy={203} r={139} fill="none" stroke={color.onInk} strokeOpacity={0.2} />
      <Circle cx={226} cy={203} r={95} fill="none" stroke={color.onInk} strokeOpacity={0.2} />
      <Circle cx={226} cy={203} r={47} fill="none" stroke={color.onInk} strokeOpacity={0.15} />
      {ticks.map((tick, i) => <Line key={i} {...tick} stroke={color.onInk} strokeOpacity={i % 5 === 0 ? 0.38 : 0.22} />)}
      <Path d="M88 236 188 184 269 220 346 134" fill="none" stroke={color.accent} strokeOpacity={0.62} />
      <Path d="M217 203h18m-9-9v18" fill="none" stroke={color.onInk} strokeOpacity={0.4} />
      {[[88, 236], [188, 184], [269, 220], [346, 134]].map(([cx, cy]) =>
        <Circle key={cx} cx={cx} cy={cy} r={4} fill={color.accent} />)}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  dial: { position: 'absolute', width: 440, height: 418, right: 0, bottom: -98 },
  compact: { width: 305, height: 290, right: -136, bottom: -107, opacity: 0.35 },
});
