import { useEffect, useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Timer, Volume2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { workoutSafetyReply } from '../../shared/session-safety.mjs';
import { useCoachVoice } from '../platform/useCoachVoice';
import { color } from '../theme';
import type { Exercise, ExerciseSet, SessionCoachQuestion } from '../types';
import { useRestTimer } from '../useRestTimer';
import { useWorkspace } from '../workspace';
import { formatCountdown } from './Countdown';
import { Button, Copy, Input } from './ui';

type Phase = SessionCoachQuestion['phase'];

type Props = {
  phase: Phase;
  exercise?: Exercise;
  name: string;
  target?: ExerciseSet;
  setNumber: number;
  setCount: number;
  restUntil?: number;
  nextName?: string;
  canFinish: boolean;
  onContinue: () => void;
  onExtendRest: () => void;
  onSkip: () => void;
  onReport: (amount: number) => string;
};

function guidance({ phase, exercise, name, target, setNumber, setCount, nextName, canFinish }: Props, seconds: number) {
  const reps = target?.reps;
  const amount = reps === undefined ? '' : exercise?.unit === 'seconds' ? `${reps}-second hold`
    : `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
  const weight = target?.load;
  const load = weight ? `${weight.value} ${weight.unit}${exercise?.loadType === 'per-dumbbell' ? ' per dumbbell' : ''}` : '';
  const equipment = exercise?.equipment.map((item) => item.toLowerCase()).join(' and ');
  const gear = [equipment ? `Get your ${equipment} ready.` : 'Get into position.', load ? `Planned load is ${load}.` : ''].filter(Boolean).join(' ');

  switch (phase) {
    case 'setup':
      return { title: `Get ready for ${name}`, prompt: `${gear} Tell me when you’re ready.` };
    case 'set': {
      const cue = setNumber === 1 ? exercise?.cues[0] : undefined;
      return {
        title: `Set ${setNumber} of ${setCount}`,
        prompt: [amount && `Aim for ${amount}${load ? ` at ${load}` : ''}.`, cue, 'Tell me what you did when you’re done.']
          .filter(Boolean).join(' '),
      };
    }
    case 'rest':
      return seconds > 0
        ? { title: 'Take a break', prompt: `Set ${setNumber - 1} is logged. Take a breather and get some water if you need it.` }
        : { title: 'Rest complete', prompt: nextName ? `Up next is ${nextName}. Tell me when you’re ready to move on.`
          : `Set ${setNumber} is next. Take more time if you need it.` };
    case 'complete':
      return nextName
        ? { title: 'Ready to move on?', prompt: `Next up is ${nextName}.` }
        : { title: 'Lineup complete', prompt: canFinish ? 'Review the sets you logged when you’re ready to finish.'
          : 'Pick an exercise from the lineup to keep going or pause here.' };
  }
}

export function SessionCoach(props: Props) {
  const { phase, restUntil, nextName, onContinue, onExtendRest, onSkip } = props;
  const rest = useRestTimer(restUntil ?? null);
  const seconds = Math.min(rest.seconds, rest.remaining());
  const canExtendRest = seconds <= 270;
  const { title, prompt } = guidance(props, seconds);
  const voice = useCoachVoice(`${title}. ${prompt}`);
  const continuing = phase === 'setup' ? 'I’m ready'
    : phase === 'rest' && seconds > 0 ? 'Skip rest'
    : nextName ? 'Next exercise' : 'I’m ready';

  return <View style={styles.coach}>
    <View style={styles.header}>
      <View style={styles.heading}>
        <View style={styles.icon}><MessageCircle size={16} color={color.plum} aria-hidden /></View>
        <Copy weight="bold" size={13} tone={color.plum}>Workout coach</Copy>
      </View>
      {voice.available && <Button compact kind="quiet" icon={Volume2} aria-pressed={voice.enabled}
        onPress={voice.toggle}>{voice.enabled ? 'Voice on' : 'Voice off'}</Button>}
    </View>
    <View role="status" accessibilityLiveRegion="polite" style={{ gap: 3 }}>
      <Copy size={19} weight="bold">{title}</Copy>
      <Copy size={14}>{prompt}</Copy>
    </View>
    {phase === 'rest' && <View style={styles.heading}>
      <Timer size={18} color={color.plum} aria-hidden />
      <Copy role="timer" size={28} weight="extra" tone={color.plum} style={{ fontVariant: ['tabular-nums'] }}>{formatCountdown(seconds)}</Copy>
    </View>}
    <View style={styles.actions}>
      {(phase === 'setup' || phase === 'rest' || phase === 'complete' && nextName) &&
        <Button kind={phase === 'rest' && seconds > 0 ? 'outline' : 'primary'} end={ArrowRight} onPress={onContinue}>{continuing}</Button>}
      {phase === 'rest' && <Button disabled={!canExtendRest} onPress={onExtendRest}>Add 30 seconds</Button>}
      {(phase === 'setup' || phase === 'set') && <Button compact kind="quiet" onPress={onSkip}>Skip exercise</Button>}
    </View>
    <CoachMessages key={`${props.exercise?.id ?? props.name}:${phase}:${props.setNumber}`}
      {...props} restRemaining={seconds} canExtendRest={canExtendRest} prompt={prompt} />
  </View>;
}

function CoachMessages(props: Props & { restRemaining: number; canExtendRest: boolean; prompt: string }) {
  const { phase, exercise, target, setNumber, onContinue, onExtendRest, onSkip, onReport, canExtendRest, restRemaining, prompt } = props;
  const { data, api } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [exchange, setExchange] = useState<{ question: string; reply?: string }>();
  const request = useRef<AbortController | null>(null);
  const busy = Boolean(exchange && exchange.reply === undefined);
  useEffect(() => () => request.current?.abort(), []);

  async function send() {
    const question = text.trim();
    if (!question || request.current) return;
    const command = question.toLowerCase().replace(/[.!?]+$/, '').replace(/’/g, "'");
    const ready = /^(?:(?:ok(?:ay)?|yes)[, ]+)?(?:i(?:'m| am) )?ready$/.test(command);
    const moreTime = /^(?:more time|(?:i )?need more time|wait|add 30 seconds)$/.test(command);
    const reply = (reply: string) => setExchange({ question, reply });
    setText('');

    const safety = workoutSafetyReply(question);
    if (safety) { reply(safety); return; }
    if (ready) {
      if (phase === 'setup' || phase === 'rest' && !restRemaining) onContinue();
      else if (phase === 'rest') reply('The timer is still running. You can skip the rest if you’re ready.');
      else reply(prompt);
      return;
    }
    if (phase === 'rest' && command === 'skip rest') { onContinue(); return; }
    if ((phase === 'setup' || phase === 'set') && command === 'skip exercise') { onSkip(); return; }
    if (moreTime && phase === 'rest') {
      if (canExtendRest) onExtendRest();
      reply(canExtendRest ? 'I added 30 seconds. Take your time.' : 'The countdown already has close to five minutes left.');
      return;
    }
    if (moreTime && phase === 'setup') { reply('Take your time. I’ll wait here until you’re ready.'); return; }
    const report = /^(?:(?:i )?(?:did |held (?:for )?))?(\d{1,3}) ?(reps?|seconds?|secs?)$/.exec(command);
    if (report) {
      if (phase !== 'set') {
        reply('You can report reps or hold time when the next set starts.');
        return;
      }
      const amount = Number(report[1]);
      const seconds = report[2].startsWith('sec');
      if (seconds !== (exercise?.unit === 'seconds')) reply(seconds ? 'Report this set in reps.' : 'Report this hold in seconds.');
      else if (amount < 1 || amount > 600) reply('Enter a number from 1 to 600.');
      else reply(onReport(amount));
      return;
    }
    const cue = exercise?.technique?.do ?? exercise?.cues[0];
    const asksAboutGear = /\b(?:equipment|gear|dumbbells?|bench|bar)\b/i.test(question);
    const asksAboutTarget = /\b(?:target|how (?:many|long|much)|reps?|seconds?|weight|load)\b/i.test(question);
    const local = asksAboutGear ? guidance({ ...props, phase: 'setup' }, 0).prompt
      : asksAboutTarget && target ? guidance({ ...props, phase: 'set' }, 0).prompt : cue ?? prompt;
    if (!exercise || !data?.aiAvailable) { reply(local); return; }

    const controller = new AbortController();
    request.current = controller;
    setExchange({ question });
    try {
      const { reply: answer } = await api.sessionCoach({
        exerciseId: exercise.id, phase, setNumber: Math.min(setNumber, 30),
        target: target && { reps: target.reps, load: target.load }, question,
      }, controller.signal);
      if (!controller.signal.aborted) reply(answer);
    } catch {
      if (!controller.signal.aborted) reply(`AI reply unavailable. ${local}`);
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return <View style={{ gap: 7 }}>
    <Button compact kind="quiet" aria-expanded={open} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(!open)}>
      {open ? 'Hide messages' : 'Message coach'}
    </Button>
    {open && <>
      <View style={styles.message}>
        <Input label="Message the coach" hideLabel placeholder={phase === 'set' ? 'Ask a question or report your set' : 'Ask about this exercise or say “I’m ready”'}
          maxLength={280} value={text} onChangeText={setText} onSubmitEditing={() => void send()} />
        <Button compact disabled={!text.trim() || busy} onPress={() => void send()}>Send</Button>
      </View>
      {data?.aiAvailable && <Copy size={12} tone={color.muted}>Questions that need AI are sent to OpenAI.</Copy>}
      {exchange && <View style={styles.exchange}>
        <Copy size={12} weight="semibold" tone={color.plum}>You · {exchange.question}</Copy>
        <Copy size={13} role="status" accessibilityLiveRegion="polite">{exchange.reply ?? 'Coach is replying…'}</Copy>
      </View>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  coach: { borderRadius: 10, backgroundColor: color.tint, borderWidth: 1, borderColor: color.line, padding: 13, gap: 9 },
  icon: { backgroundColor: color.surface, width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  exchange: { gap: 4, padding: 9, backgroundColor: color.surface, borderRadius: 7 },
});
