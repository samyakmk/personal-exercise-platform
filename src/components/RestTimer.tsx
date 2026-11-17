import { useState } from 'react';
import { Timer } from 'lucide-react-native';
import { View } from 'react-native';
import { color } from '../theme';
import { useRestTimer } from '../useRestTimer';
import { Countdown, formatCountdown } from './Countdown';
import { Button, Copy, Input } from './ui';

export function RestTimer({ deadline, onDeadlineChange, expanded: controlledExpanded, onExpandedChange }: {
  deadline?: number | null; onDeadlineChange?: (deadline: number | null) => void;
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
} = {}) {
  const timer = useRestTimer(deadline, onDeadlineChange);
  const [localExpanded, setLocalExpanded] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const duration = Number(minutes) * 60 + Number(seconds);
  const wholeNumbers = /^\d*$/.test(minutes) && /^\d*$/.test(seconds);
  const durationFits = Number.isSafeInteger(Date.now() + duration * 1000);
  const validDuration = wholeNumbers && durationFits && duration > 0;
  const running = timer.active && timer.seconds > 0;

  function start(duration: number) {
    timer.start(duration);
    setExpanded(true);
  }

  function startCustom() {
    if (validDuration) start(duration);
  }

  function stop() {
    timer.clear();
    setExpanded(false);
  }

  return <View style={{ gap: 6, borderTopWidth: 1, borderColor: color.line, paddingTop: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
      <Timer size={16} color={color.forest} aria-hidden />
      <Copy size={13} weight="semibold">Rest timer</Copy>
      {!expanded && timer.active && !running && <Copy role="status" accessibilityLiveRegion="polite" size={13}>Rest complete</Copy>}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {running ? <>
        <Button compact onPress={() => setExpanded(true)}>{`Show timer · ${formatCountdown(timer.seconds)}`}</Button>
        <Button compact kind="quiet" onPress={stop}>Stop timer</Button>
      </> : <>
        {[30, 60, 90].map((duration) => <Button key={duration} compact
          accessibilityLabel={`${duration}s · Start rest timer`}
          onPress={() => start(duration)}>{`${duration}s`}</Button>)}
      </>}
    </View>
    {!running && <View role="group" accessibilityLabel="Custom rest duration" style={{ gap: 7, maxWidth: 360 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 7 }}>
        <View style={{ flex: 1, minWidth: 60 }}>
          <Input label="Rest minutes" visibleLabel="Minutes" placeholder="0" value={minutes} inputMode="numeric"
            onChangeText={setMinutes} onSubmitEditing={startCustom} />
        </View>
        <View style={{ flex: 1, minWidth: 60 }}>
          <Input label="Rest seconds" visibleLabel="Seconds" placeholder="0" value={seconds} inputMode="numeric"
            onChangeText={setSeconds} onSubmitEditing={startCustom} />
        </View>
        <Button compact disabled={!validDuration} style={{ alignSelf: 'flex-end', minHeight: 43 }}
          onPress={startCustom}>Start custom timer</Button>
      </View>
      {(!wholeNumbers || !durationFits) && <Copy size={12} tone={color.danger} role="status">
        {wholeNumbers ? 'Enter a shorter duration.' : 'Use whole numbers for minutes and seconds.'}
      </Copy>}
    </View>}
    {expanded && timer.active && <Countdown kind="Rest" seconds={timer.seconds}
      onMinimize={() => setExpanded(false)} onStop={stop} onDone={stop} />}
  </View>;
}
