import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Dialog } from '../platform/Dialog';
import { color } from '../theme';
import { Button, Copy } from './ui';

export function formatCountdown(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

export function Countdown({ kind, seconds, onMinimize, onStop, onDone }: {
  kind: 'Rest' | 'Hold'; seconds: number; onMinimize: () => void; onStop: () => void; onDone: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const label = `${kind} timer`;
  const time = formatCountdown(seconds);
  const complete = seconds === 0;
  const size = Math.floor(Math.min(224, height * 0.4, (Math.min(width, 1050) - 60) / (time.length * 0.66)));
  return <Dialog label={label} wide onClose={complete ? onDone : onMinimize}>
    <View style={styles.panel}>
      {complete
        ? <Copy role="status" accessibilityLiveRegion="polite" size={23} weight="semibold" tone={color.accent}>{`${kind} complete`}</Copy>
        : <Copy size={23} weight="semibold" tone={color.onInk}>{label}</Copy>}
      <Copy role="timer" size={size} weight="extra" tone={color.surface}
        style={[styles.time, { lineHeight: Math.round(size * 1.12) }]}>{time}</Copy>
      <View style={styles.actions}>
        <Button kind="primary" onPress={complete ? onDone : onStop}>
          {complete ? 'Done' : kind === 'Rest' ? 'Stop timer' : 'Stop hold timer'}
        </Button>
        {!complete && <Button onPress={onMinimize}>Minimize timer</Button>}
      </View>
    </View>
  </Dialog>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: color.ink, alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 24 },
  time: { fontVariant: ['tabular-nums'], textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
});
