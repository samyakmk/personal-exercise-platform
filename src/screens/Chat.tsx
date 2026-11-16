import { Link } from 'expo-router';
import { ArrowUp, BookmarkPlus, Check, ClipboardList, Dumbbell, MessageCircle, Plus, Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useTrainingChat } from '../chat';
import { trainingNoteEffect } from '../components/TrainingNotes';
import { Button, Copy, Display, Loading, Notice, Panel, styles as ui } from '../components/ui';
import { color } from '../theme';
import type { TrainingNoteInput } from '../types';
import { useWorkspace } from '../workspace';

const prompts = [
  { label: 'Look up a weight', icon: Dumbbell, message: 'What weight did I use last time for dumbbell curls?' },
  { label: 'Review my week', icon: ClipboardList, message: 'How many sessions did I log last week?' },
  { label: 'Share trainer feedback', icon: BookmarkPlus, message: 'My trainer suggested ' },
];

export function ChatScreen() {
  const { data } = useWorkspace();
  const { turns, pending, send, retry, reset } = useTrainingChat();
  const [draft, setDraft] = useState('');
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
        <Copy size={compact ? 12 : 14} tone={color.muted}>Ask about your workouts or talk through what’s working.</Copy>
      </View>
      {hasMessages && <Button compact icon={Plus} onPress={() => { reset(); setDraft(''); composer.current?.focus(); }}>New chat</Button>}
    </View>
    <Panel style={styles.panel}>
      <View style={[styles.panelTop, compact && styles.insetCompact]}>
        <View style={styles.avatar}><Sparkles aria-hidden size={15} color={color.plum} /></View>
        <Copy size={13} weight="bold">Liftmorrow</Copy>
      </View>
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={[styles.thread, compact && styles.threadCompact]}
        role="log" accessibilityLabel="Conversation" aria-live="polite" accessibilityLiveRegion="polite"
        keyboardShouldPersistTaps="handled" onContentSizeChange={() => { if (waiting) scroll.current?.scrollToEnd({ animated: false }); }}>
        {!hasMessages && <View style={styles.welcome}>
          <View style={styles.welcomeMark}><MessageCircle aria-hidden size={25} color={color.accent} strokeWidth={1.7} /></View>
          <Display accessibilityRole="header" aria-level={2} size={compact ? 29 : 40}>What’s on your mind?</Display>
          <Copy size={13} tone={color.muted} style={styles.welcomeCopy}>Look up what you logged, get a second perspective on training, or save feedback to help shape future suggestions.</Copy>
          <View style={styles.prompts}>
            {prompts.map(({ label, message, icon }) => <Button key={label} compact icon={icon} disabled={!available}
              onPress={() => { setDraft(message); composer.current?.focus(); }}>{label}</Button>)}
          </View>
        </View>}
        {turns.map(({ id, message, answer }) => <View style={styles.exchange} key={id}>
          <UserMessage text={message} />
          <View style={styles.assistant}>
            <View style={styles.avatar}><Sparkles aria-hidden size={15} color={color.plum} /></View>
            <View style={styles.answer}>
              <Copy size={11} tone={color.plum} weight="bold">Liftmorrow</Copy>
              <Copy>{answer.reply}</Copy>
              {answer.note && <SaveNote id={id} note={answer.note} />}
            </View>
          </View>
        </View>)}
        {pending && <View style={styles.exchange}>
          <UserMessage text={pending.message} />
          {pending.error ? <Notice error action={<Button compact onPress={retry} disabled={!available}>Retry message</Button>}>{pending.error}</Notice>
            : <Loading label="Liftmorrow is replying…" />}
        </View>}
      </ScrollView>
      <View style={[styles.composer, compact && styles.insetCompact]}>
        {!available && <Notice>Chat is unavailable until the Liftmorrow server has an OpenAI key.</Notice>}
        <View style={styles.composeRow}>
          <TextInput ref={composer} accessibilityLabel="Message" editable={available} placeholder="Message Liftmorrow…"
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
      </View>
    </Panel>
  </View>;
}

function UserMessage({ text }: { text: string }) {
  return <View style={styles.user}>
    <Copy size={11} tone={color.plum} weight="bold">You</Copy>
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
      {saved ? <Check aria-hidden size={15} color={color.plum} /> : <BookmarkPlus aria-hidden size={15} color={color.plum} />}
      <Copy size={12} weight="bold" tone={color.plum}>{saved ? 'Saved to your profile' : 'Keep this training note?'}</Copy>
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
  page: { flex: 1, minHeight: 0, width: '100%', maxWidth: 1000, alignSelf: 'center', paddingTop: 24, paddingBottom: 28, gap: 18 },
  pageCompact: { paddingTop: 12, paddingBottom: 10, gap: 12 },
  heading: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  panel: { flex: 1, minHeight: 0, overflow: 'hidden' },
  panelTop: { paddingHorizontal: 22, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9,
    borderBottomWidth: 1, borderColor: color.line },
  insetCompact: { paddingHorizontal: 10 },
  avatar: { width: 29, height: 29, borderRadius: 9, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, minHeight: 0 },
  thread: { flexGrow: 1, paddingHorizontal: 26, paddingVertical: 20, gap: 21 },
  threadCompact: { paddingHorizontal: 10, paddingVertical: 12 },
  welcome: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingVertical: 15 },
  welcomeMark: { width: 47, height: 47, borderRadius: 13, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  welcomeCopy: { maxWidth: 405, textAlign: 'center' },
  prompts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7, marginTop: 4 },
  exchange: { gap: 13 },
  user: { alignSelf: 'flex-end', maxWidth: '87%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: color.tint, gap: 3 },
  assistant: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, maxWidth: '100%' },
  answer: { flex: 1, minWidth: 0, maxWidth: 695, gap: 4, paddingTop: 2 },
  note: { gap: 7, padding: 11, borderRadius: 9, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas, marginTop: 7 },
  noteTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileLink: { color: color.plum, textDecorationLine: 'underline', fontSize: 13 },
  composer: { borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 22, paddingVertical: 12, gap: 7 },
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  input: { flex: 1, minWidth: 0, minHeight: 49, maxHeight: 97, paddingTop: 10, paddingBottom: 9, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', minHeight: 49 },
});
