import { Link } from 'expo-router';
import { ArrowUp, BookmarkPlus, Check, ClipboardList, Dumbbell, MessageCircle, Plus, Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useTrainingChat } from '../chat';
import { Sheet } from '../components/Sheet';
import { trainingNoteEffect } from '../components/TrainingNotes';
import { Button, Copy, Display, Loading, Notice, Panel, styles as ui } from '../components/ui';
import { ExercisePicker } from '../platform/ExercisePicker';
import { SelectField } from '../platform/fields';
import { color, radius } from '../theme';
import type { HistoryResult, TrainingNoteInput } from '../types';
import { useWorkspace } from '../workspace';

const prompts = [
  { label: 'Share trainer feedback', icon: BookmarkPlus, message: 'My trainer suggested ' },
];

export function ChatScreen() {
  const { data } = useWorkspace();
  const { turns, pending, send, retry, reset } = useTrainingChat();
  const [draft, setDraft] = useState('');
  const [lookup, setLookup] = useState<'week' | 'weight' | null>(null);
  const scroll = useRef<ScrollView>(null);
  const composer = useRef<TextInput>(null);
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const available = Boolean(data?.aiAvailable);
  const waiting = Boolean(pending && !pending.error);
  const hasMessages = Boolean(turns.length || pending);

  useEffect(() => {
    if (!hasMessages) return;
    const frame = requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [turns, pending, hasMessages]);

  function submit() {
    if (!available || !send(draft)) return;
    setDraft('');
    composer.current?.focus();
  }

  return <View style={[styles.page, compact && styles.pageCompact]}>
    <View style={styles.heading}>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Display accessibilityRole="header" aria-level={1} size={compact ? 38 : 54}>Chat</Display>
      </View>
      {hasMessages && <Button compact icon={Plus} onPress={() => { reset(); setDraft(''); composer.current?.focus(); }}>New chat</Button>}
    </View>
    <View style={styles.prompts}>
      <Button compact icon={Dumbbell} onPress={() => setLookup('weight')}>Look up a weight</Button>
      <Button compact icon={ClipboardList} onPress={() => setLookup('week')}>Review my week</Button>
    </View>
    {!available && !hasMessages ? <Notice>Chat is currently unavailable.</Notice> : <Panel style={[styles.panel, !hasMessages && styles.compactPanel]}>
      <ScrollView ref={scroll} style={[styles.scroll, !hasMessages && styles.compactPanel]} contentContainerStyle={[styles.thread, compact && styles.threadCompact]}
        role="log" accessibilityLabel="Conversation" aria-live="polite" accessibilityLiveRegion="polite"
        keyboardShouldPersistTaps="handled" onContentSizeChange={() => { if (waiting) scroll.current?.scrollToEnd({ animated: false }); }}>
        {!hasMessages && available && <View style={styles.welcome}>
          <View style={styles.welcomeMark}><MessageCircle aria-hidden size={25} color={color.accent} strokeWidth={1.7} /></View>
          <Display accessibilityRole="header" aria-level={2} size={compact ? 29 : 40} style={styles.welcomeTitle}>What’s on your mind?</Display>
          <Copy size={14} tone={color.muted} style={styles.welcomeCopy}>Ask about your workouts or share guidance from your trainer.</Copy>
          <View style={styles.prompts}>
            {prompts.map(({ label, message, icon }) => <Button key={label} compact icon={icon}
              onPress={() => { setDraft(message); composer.current?.focus(); }}>{label}</Button>)}
          </View>
        </View>}
        {turns.map(({ id, message, answer }) => <View style={styles.exchange} key={id}>
          <UserMessage text={message} />
          <View style={styles.assistant}>
            <View style={styles.avatar}><Sparkles aria-hidden size={15} color={color.forest} /></View>
            <View style={styles.answer}>
              <Copy size={11} tone={color.forest} weight="bold">Trainer Plus</Copy>
              <Copy>{answer.reply}</Copy>
              {answer.note && <SaveNote id={id} note={answer.note} />}
            </View>
          </View>
        </View>)}
        {pending && <View style={styles.exchange}>
          <UserMessage text={pending.message} />
          {pending.error ? <Notice error action={<Button compact onPress={retry} disabled={!available}>Retry message</Button>}>{pending.error}</Notice>
            : <Loading label="Trainer Plus is replying…" />}
        </View>}
      </ScrollView>
      {available ? <View style={[styles.composer, compact && styles.insetCompact]}>
        <View style={styles.composeRow}>
          <TextInput ref={composer} accessibilityLabel="Message" editable={available} placeholder="Message Trainer Plus…"
            placeholderTextColor={color.faint} maxLength={1200} multiline value={draft} onChangeText={setDraft}
            blurOnSubmit={false} submitBehavior={Platform.OS === 'web' ? undefined : 'submit'}
            onKeyPress={Platform.OS === 'web' ? (event) => {
              const { key, shiftKey, nativeEvent } = event as unknown as KeyboardEvent & { nativeEvent: KeyboardEvent };
              if (key === 'Enter' && !shiftKey && !nativeEvent.isComposing && nativeEvent.keyCode !== 229) {
                event.preventDefault();
                submit();
              }
            } : undefined}
            returnKeyType="send" onSubmitEditing={Platform.OS === 'web' ? undefined : submit} style={[ui.input, styles.input]} />
          <Button kind="dark" icon={ArrowUp} onPress={submit} disabled={!available || !draft.trim() || waiting} style={styles.send}>Send</Button>
        </View>
        <Copy size={11} tone={color.muted}>OpenAI uses your messages, relevant workout data, and saved notes to reply. Only notes you save are kept in your profile.</Copy>
      </View> : <View style={[styles.composer, compact && styles.insetCompact]}>
        <Notice>Chat is currently unavailable.</Notice>
      </View>}
    </Panel>}
    {lookup && <HistoryLookupSheet key={lookup} kind={lookup} onClose={() => setLookup(null)} />}
  </View>;
}

function HistoryLookupSheet({ kind, onClose }: { kind: 'week' | 'weight'; onClose: () => void }) {
  const { api, data, exerciseRecords } = useWorkspace();
  const [exerciseId, setExerciseId] = useState('');
  const [weight, setWeight] = useState<'latest' | 'heaviest'>('latest');
  const [week, setWeek] = useState<'this' | 'last'>('last');
  const [result, setResult] = useState<HistoryResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController>(null);
  useEffect(() => () => request.current?.abort(), []);

  const logged = new Set(data?.workouts.filter(({ status, example }) => status === 'completed' && !example)
    .flatMap(({ exercises }) => exercises.filter((item) => (item.setDetails?.length ?? item.sets) > 0).map(({ exerciseId }) => exerciseId)));
  const options = [...exerciseRecords.values()]
    .filter(({ id }) => logged.has(id))
    .map(({ id, name }) => ({ value: id, label: name }));
  function clearResult() { setResult(undefined); setError(''); }

  async function lookup() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    clearResult();
    setBusy(true);
    try {
      const answer = await api.historyLookup(kind === 'week' ? { kind, week } : { kind, weight, exerciseId }, controller.signal);
      if (!controller.signal.aborted) setResult(answer);
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <Sheet title={kind === 'week' ? 'Review my week' : 'Look up a weight'} onClose={onClose}>
    {kind === 'week' ? <SelectField label="Week" value={week} onChange={(value) => { setWeek(value as typeof week); clearResult(); }}
      disabled={busy} options={[{ value: 'last', label: 'Last week' }, { value: 'this', label: 'This week' }]} /> : <>
      <ExercisePicker label="Exercise you logged" value={exerciseId} onChange={(value) => { setExerciseId(value); clearResult(); }}
        disabled={busy || !options.length} options={options} />
      {!options.length && <Copy tone={color.muted}>Log an exercise set to look up its weight here.</Copy>}
      <SelectField label="Weight to find" value={weight} onChange={(value) => { setWeight(value as typeof weight); clearResult(); }}
        disabled={busy} options={[{ value: 'latest', label: 'Latest session' }, { value: 'heaviest', label: 'Heaviest logged' }]} />
    </>}
    <Button kind="primary" onPress={() => void lookup()} disabled={busy || (kind === 'weight' && !exerciseId)}>
      {busy ? 'Looking up…' : kind === 'week' ? 'Find sessions' : 'Find weight'}
    </Button>
    {error && <Notice error>{error}</Notice>}
    {result && <View style={styles.historyResult}>
      <Copy role="status" accessibilityLiveRegion="polite">{result.reply}</Copy>
      {result.sources.map(({ id, name, date }) => <Link key={id} style={styles.profileLink}
        href={{ pathname: '/sessions', params: { session: id } }}>{`${name} · ${date}`}</Link>)}
      {result.week && result.sources.length > 0 && <Link style={styles.profileLink}
        href={{ pathname: '/sessions', params: { week: result.week } }}>View the full week in Sessions</Link>}
    </View>}
  </Sheet>;
}

function UserMessage({ text }: { text: string }) {
  return <View style={styles.user}>
    <Copy size={11} tone={color.forest} weight="bold">You</Copy>
    <Copy>{text}</Copy>
  </View>;
}

function SaveNote({ id, note }: { id: string; note: TrainingNoteInput }) {
  const { api, data, exerciseRecords, mutate } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = data?.trainingNotes?.some((item) => item.id === id);
  async function save() {
    if (busy || saved) return;
    setBusy(true);
    setError('');
    try { await mutate(() => api.saveTrainingNote(id, note)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <View style={styles.note}>
    <View style={styles.noteTitle}>
      {saved ? <Check aria-hidden size={15} color={color.forest} /> : <BookmarkPlus aria-hidden size={15} color={color.forest} />}
      <Copy size={12} weight="bold" tone={color.forest}>{saved ? 'Saved to your profile' : 'Keep this training note?'}</Copy>
    </View>
    <Copy size={13}>{note.text}</Copy>
    <Copy size={12} tone={color.muted}>{trainingNoteEffect(note, exerciseRecords.get(note.exerciseId ?? '')?.name)}</Copy>
    {saved
      ? <Link href="/profile" style={styles.profileLink}>View training notes in Profile</Link>
      : <Button compact onPress={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save to profile'}</Button>}
    {error !== '' && <Notice error>{error}</Notice>}
  </View>;
}

const styles = StyleSheet.create({
  historyResult: { gap: 9 },
  page: { flex: 1, minHeight: 0, width: '100%', maxWidth: 1000, alignSelf: 'center', paddingBottom: 24, gap: 15 },
  pageCompact: { paddingBottom: 12, gap: 12 },
  heading: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  panel: { flex: 1, minHeight: 0, overflow: 'hidden' },
  compactPanel: { flexGrow: 0, flexBasis: 'auto', flexShrink: 1 },
  insetCompact: { paddingHorizontal: 10 },
  avatar: { width: 29, height: 29, borderRadius: radius.control, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, minHeight: 0 },
  thread: { flexGrow: 1, paddingHorizontal: 26, paddingVertical: 20, gap: 21 },
  threadCompact: { paddingHorizontal: 10, paddingVertical: 12 },
  welcome: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  welcomeMark: { width: 47, height: 47, borderRadius: 24, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: { textAlign: 'center' },
  welcomeCopy: { maxWidth: 405, textAlign: 'center' },
  prompts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7, marginTop: 4 },
  exchange: { gap: 13 },
  user: { alignSelf: 'flex-end', maxWidth: '87%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.panel, backgroundColor: color.tint, gap: 3 },
  assistant: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, maxWidth: '100%' },
  answer: { flex: 1, minWidth: 0, maxWidth: 695, gap: 4, paddingTop: 2 },
  note: { gap: 7, padding: 11, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas, marginTop: 7 },
  noteTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileLink: { color: color.forest, textDecorationLine: 'underline', fontSize: 13 },
  composer: { borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 22, paddingVertical: 12, gap: 7 },
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  input: { flex: 1, minWidth: 0, minHeight: 49, maxHeight: 97, paddingTop: 10, paddingBottom: 9, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', minHeight: 49 },
});
