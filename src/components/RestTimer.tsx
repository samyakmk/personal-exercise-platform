import { Timer } from 'lucide-react-native';
import { View } from 'react-native';
import { color } from '../theme';
import { useRestTimer } from '../useRestTimer';
import { Button, Copy } from './ui';

export function RestTimer({ deadline, onDeadlineChange }: {
  deadline?: number | null; onDeadlineChange?: (deadline: number | null) => void;
} = {}) {
  const timer = useRestTimer(deadline, onDeadlineChange);
  const seconds = timer.seconds % 60;
  const time = `${Math.floor(timer.seconds / 60)}:${String(seconds).padStart(2, '0')}`;
  return <View style={{ gap: 6, borderTopWidth: 1, borderColor: color.line, paddingTop: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
      <Timer size={16} color={color.plum} />
      <Copy size={13} weight="semibold">Rest timer</Copy>
      {timer.active && <Copy size={14} tone={color.plum} weight="bold">{time}</Copy>}
      {timer.active && timer.seconds === 0 && <Copy role="status" accessibilityLiveRegion="polite" size={13}>Rest complete</Copy>}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {timer.active && timer.seconds > 0
        ? <Button compact kind="quiet" onPress={timer.clear}>Stop timer</Button>
        : [30, 60, 90].map((duration) => <Button key={duration} compact
          accessibilityLabel={`${duration}s · Start rest timer`}
          onPress={() => timer.start(duration)}>{`${duration}s`}</Button>)}
    </View>
  </View>;
}
