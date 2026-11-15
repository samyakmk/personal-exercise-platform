import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { createId, RequestError } from '../api';
import { signalWorkspaceUpdate, watchWorkspaceUpdates } from '../platform/workspaceUpdates';
import { color } from '../theme';
import type { CheckInChoice, CheckInInput, CheckInState } from '../types';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { Button, Chip, Copy, IconButton, Input, Loading, Notice, SectionTitle } from './ui';

const choices = [
  { value: 'easier', label: 'Go lighter' },
  { value: 'rest', label: 'Rest today' },
  { value: 'usual', label: 'Clear adjustment' },
] as const;
const adjustmentLabel = (value: CheckInChoice) =>
  value === 'easier' ? 'Lighter day' : value === 'rest' ? 'Rest today' : 'Adjustment cleared';

export function useCheckIns(day: string) {
  const { api, data, reload } = useWorkspace();
  const ready = Boolean(data);
  const [state, setState] = useState<CheckInState>();
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const writes = useRef(0);
  const activeDay = useRef(day);
  activeDay.current = day;

  const refresh = useCallback(() => {
    if (!ready) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setError('');
    void api.checkIns(day, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    }, (failure: Error) => {
      if (controller.signal.aborted) return;
      if (failure instanceof RequestError && [404, 409].includes(failure.status)) reload();
      setError(failure.message);
    });
  }, [api, day, ready, reload]);
  useEffect(() => {
    refresh();
    const unwatch = watchWorkspaceUpdates(refresh, 'companion');
    return () => { unwatch(); pending.current?.abort(); };
  }, [refresh]);

  async function mutate(action: () => Promise<CheckInState>) {
    const request = ++writes.current;
    try {
      const next = await action();
      if (request === writes.current && next.day === activeDay.current) {
        pending.current?.abort();
        setState(next);
        setError('');
      }
      signalWorkspaceUpdate('companion');
    } catch (failure) {
      if (failure instanceof RequestError && [404, 409].includes(failure.status)) reload();
      throw failure;
    }
  }
  return {
    state: state?.day === day ? state : undefined, error, refresh,
    save: (entry: CheckInInput) => mutate(() => api.saveCheckIn(day, entry)),
    remove: (id: string) => mutate(() => api.removeCheckIn(day, id)),
  };
}

export function TrainingCheckIn({ journal, currentTime, onClose }: {
  journal: ReturnType<typeof useCheckIns>; currentTime: string; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<CheckInChoice>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const pending = useRef<{ id: string; time: string; key: string }>(null);
  const working = useRef(false);
  const adjustment = journal.state?.adjustment;

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (failure) { setError((failure as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  function send(wantsReply: boolean) {
    if (busy || (!text.trim() && !choice)) return;
    const key = JSON.stringify([text.trim(), choice, wantsReply]);
    const receipt = pending.current?.key === key ? pending.current : { key, id: createId(), time: currentTime };
    pending.current = receipt;
    void run(async () => {
      await journal.save({ id: receipt.id, text, adjustment: choice, time: receipt.time, wantsReply });
      pending.current = null;
      setText('');
      setChoice(undefined);
      setMessage(wantsReply ? 'Check-in saved with an app reply.' : 'Check-in saved privately.');
    });
  }

  return <Sheet title="Training check-in" detail="Leave a private note or ask about your suggested session. A note can stay just a note."
    onClose={() => { if (!working.current) onClose(); }}>
    <View style={styles.block}>
      <Input label="What did you notice, or what would you like to ask?" value={text} onChangeText={setText}
        maxLength={1200} multiline editable={!busy} placeholder="For example, my trainer wants me to work on tempo."
        style={{ minHeight: 84, paddingVertical: 9 }} />
      <Copy size={12} tone={color.muted}>Choose an adjustment if you want to change today’s suggestion. Notes and replies stay in this profile.</Copy>
      {adjustment && adjustment !== 'usual' && <Copy size={13} weight="semibold" tone={color.plum}>Active today: {adjustmentLabel(adjustment)}</Copy>}
      <View role="group" accessibilityLabel="Adjust today’s suggestion" style={styles.actions}>
        {choices.filter(({ value }) => value !== 'usual' || adjustment && adjustment !== 'usual').map(({ value, label }) => (
          <Chip key={value} label={label} selected={choice === value} onPress={() => { if (!busy) setChoice(choice === value ? undefined : value); }} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button kind="primary" disabled={busy || (!text.trim() && !choice)} onPress={() => send(false)}>Save without reply</Button>
        <Button icon={MessageSquare} disabled={busy || (!text.trim() && !choice)} onPress={() => send(true)}>Save and get a reply</Button>
      </View>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </View>
    <SectionTitle title="Recent check-ins" level={3} />
    {journal.error ? <Notice error action={<Button compact onPress={journal.refresh}>Retry</Button>}>{journal.error}</Notice>
      : !journal.state ? <Loading label="Loading check-ins…" />
      : !journal.state.entries.length ? <Copy size={13} tone={color.muted}>Your check-ins will appear here.</Copy>
      : <View style={styles.feed}>
        {journal.state.entries.map((item) => <View key={item.id} style={styles.block}>
          <View style={styles.entry}>
            <View style={{ flex: 1, gap: 5 }}>
              <Copy size={11} weight="semibold" tone={color.muted}>You · {new Date(item.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Copy>
              {item.adjustment && <Copy size={12} weight="semibold" tone={color.plum}>{adjustmentLabel(item.adjustment)}</Copy>}
              {item.text ? <Copy size={14}>{item.text}</Copy> : null}
            </View>
            <IconButton icon={Trash2} label="Delete check-in" size={32} disabled={busy} onPress={() => setDeleting(item.id)} />
          </View>
          {item.reply && <View style={styles.reply}>
            <Copy size={11} tone={color.plum} weight="bold">Liftmorrow</Copy>
            <Copy size={13}>{item.reply}</Copy>
          </View>}
          {deleting === item.id && <View style={styles.actions}>
            <Button compact disabled={busy} onPress={() => setDeleting(undefined)}>Keep check-in</Button>
            <Button compact kind="danger" disabled={busy} onPress={() => void run(async () => {
              await journal.remove(item.id);
              setDeleting(undefined);
              setMessage('Check-in deleted.');
            })}>Delete this check-in</Button>
          </View>}
        </View>)}
      </View>}
  </Sheet>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  block: { gap: 8 },
  feed: { gap: 14 },
  entry: { backgroundColor: color.canvas, borderRadius: 10, padding: 11, gap: 8, flexDirection: 'row', alignItems: 'flex-start' },
  reply: { backgroundColor: color.tint, borderRadius: 10, marginLeft: 18, padding: 11, gap: 4 },
});
