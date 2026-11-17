import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Dumbbell, LogOut, Plus, Trash2 } from 'lucide-react-native';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { EquipmentSheet } from '../components/EquipmentSheet';
import { ProfileArchive } from '../components/ProfileArchive';
import { Sheet } from '../components/Sheet';
import { TrainingNotes } from '../components/TrainingNotes';
import { emptyPreferences, PreferenceFields, TrainingProfileHistory } from '../components/TrainingPreferences';
import { TrainingDial } from '../components/TrainingDial';
import { Wordmark } from '../components/Wordmark';
import { Button, Copy, Display, EditorialTitle, Input, Notice, PageTitle, Panel, SectionTitle } from '../components/ui';
import { useProfiles } from '../profiles';
import { color, radius } from '../theme';
import type { Profile, ProfileEdit } from '../types';

const profileColors = [color.accent, color.tint, '#c9d7b8', '#e9d7bf', '#c4d4ce'];

export function ProfileGate() {
  const { state, loadError, notice, reload, busy, create, signIn } = useProfiles();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const main = useRef<View>(null);
  const { width } = useWindowDimensions();
  const compact = width < 620;
  const tileSize = width < 360 ? 116 : compact ? 136 : 154;

  useEffect(() => {
    if (Platform.OS === 'web') document.title = 'Choose a profile · Trainer Plus';
    (main.current as unknown as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (adding && Platform.OS === 'web') document.getElementById('trainer-plus-profile-username')?.focus();
  }, [adding]);

  async function submit(action: () => Promise<void>, label: string) {
    if (busy) return;
    setWorking(label);
    setError('');
    try { await action(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setWorking(''); }
  }

  function createProfile() {
    if (!username.trim()) return;
    void submit(async () => {
      await create(username);
      router.replace('/');
    }, 'create');
  }

  return <ScrollView nativeID="trainer-plus-profile-gate" style={styles.canvas} contentContainerStyle={styles.entry} keyboardShouldPersistTaps="handled">
    <TrainingDial compact={compact} />
    <View role="banner" accessibilityLabel="Trainer Plus" style={[styles.brand, compact && styles.brandCompact]}>
      <Wordmark />
    </View>
    <View role="main" nativeID="trainer-plus-main" ref={main} tabIndex={-1} style={[styles.picker, compact && styles.pickerCompact]}>
      <EditorialTitle accessibilityRole="header" aria-level={1} size={compact ? 46 : 76} tone={color.surface} emphasisTone={color.accent}
        title="Choose a profile" style={styles.centered} />
      <Copy size={13} tone={color.onInk} style={{ textAlign: 'center' }}>Profiles are local to this browser.</Copy>
      {!state ? loadError
        ? <Notice error action={<Button compact onPress={reload}>Retry</Button>}>{loadError}</Notice>
        : <View role="status" accessibilityLiveRegion="polite" style={styles.loading}>
          <ActivityIndicator color={color.accent} />
          <Copy tone={color.onInk}>Loading profiles…</Copy>
        </View>
        : <>
          <View style={[styles.tiles, compact && styles.tilesCompact]}>
            {state.profiles.map(({ username: saved, workspaceKey }) => {
              const tileColor = profileColors[parseInt(workspaceKey.slice(0, 2), 16) % profileColors.length];
              return <Pressable key={workspaceKey} accessibilityRole="button" accessibilityLabel={'Sign in as ' + saved}
                accessibilityState={{ busy: working === workspaceKey }} disabled={busy}
                onPress={() => void submit(() => signIn(saved), workspaceKey)}
                style={({ hovered, pressed }) => [styles.tile, { width: tileSize, opacity: busy && working !== workspaceKey ? 0.6 : 1 },
                  (hovered || pressed) && styles.tileHighlighted]}>
                <View aria-hidden style={[styles.tileSquare, { backgroundColor: tileColor }]}>
                  {working === workspaceKey ? <ActivityIndicator size="large" color={color.ink} />
                    : <Display size={compact ? 62 : 74} tone={color.ink}>{saved[0].toUpperCase()}</Display>}
                </View>
                <Copy size={14} weight="semibold" tone={color.surface} style={styles.tileLabel}>{saved}</Copy>
              </Pressable>;
            })}
            <Pressable accessibilityRole="button" disabled={busy}
              onPress={() => { setUsername(''); setError(''); setAdding(true); }}
              style={({ hovered, pressed }) => [styles.tile, { width: tileSize, opacity: busy ? 0.6 : 1 },
                (hovered || pressed) && styles.tileHighlighted]}>
              <View aria-hidden style={[styles.tileSquare, state.profiles.length ? styles.addSquare : styles.firstTile]}>
                <Plus size={compact ? 38 : 44} strokeWidth={1.5} color={state.profiles.length ? color.accent : color.ink} />
              </View>
              <Copy size={14} weight="semibold" tone={color.surface} style={styles.tileLabel}>Add profile</Copy>
            </Pressable>
          </View>
          {notice !== '' && <Notice>{notice}</Notice>}
          {!adding && error !== '' && <Notice error>{error}</Notice>}
          {adding && <Sheet title="Create your profile" onClose={() => { if (!busy) { setAdding(false); setError(''); } }}>
            <Copy size={13}>Use the same browser and address to return. You can copy your training data from Data &amp; privacy after setup.</Copy>
            {state.canImportLegacy && <Notice>Your existing workouts, settings, and videos will move into this first profile.</Notice>}
            <View style={{ gap: 6 }}>
              <Input label="Username" nativeID="trainer-plus-profile-username" value={username} onChangeText={setUsername}
                autoCapitalize="none" autoCorrect={false} autoFocus={Platform.OS !== 'web'} autoComplete="off"
                maxLength={24} editable={!busy} returnKeyType="go" onSubmitEditing={createProfile} />
              <Copy size={12} tone={color.muted}>3–24 letters, numbers, underscores, or hyphens. Start with a letter or number.</Copy>
            </View>
            {error !== '' && <Notice error>{error}</Notice>}
            <Button kind="primary" end={ArrowRight} onPress={createProfile} disabled={busy || !username.trim()}>
              {working === 'create' ? 'Creating profile…' : 'Create profile'}
            </Button>
          </Sheet>}
        </>}
    </View>
  </ScrollView>;
}

export function ProfileScreen() {
  const { state, busy, signOut, save, delete: deleteProfile } = useProfiles();
  const profile = state?.active;
  if (!profile) return null;
  const key = profile.workspaceKey;
  return <ProfileSettings key={key} profile={profile} busy={busy}
    save={(details) => save(key, details)} signOut={() => signOut(key)} remove={() => deleteProfile(key)} />;
}

type Details = ProfileEdit;

function ProfileSettings({ profile, busy, save, signOut, remove }: {
  profile: Profile;
  busy: boolean;
  save: (details: Details) => Promise<void>;
  signOut: () => Promise<void>;
  remove: () => Promise<void>;
}) {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const comingFromOverview = from === 'overview';
  const savedName = profile.details.displayName ?? '';
  const savedGoal = profile.details.trainingGoal ?? '';
  const savedPreferences = JSON.stringify(profile.details.trainingPreferences ?? emptyPreferences);
  const [preferences, setPreferences] = useState(profile.details.trainingPreferences ?? emptyPreferences);
  const [displayName, setDisplayName] = useState(savedName);
  const [trainingGoal, setTrainingGoal] = useState(savedGoal);
  const [deleting, setDeleting] = useState(false);
  const [equipment, setEquipment] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<{ error: boolean; message: string }>();
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => { setDisplayName(savedName); setTrainingGoal(savedGoal); }, [savedName, savedGoal]);
  useEffect(() => { setPreferences(JSON.parse(savedPreferences)); }, [savedPreferences]);

  async function submit(action: () => Promise<void>, success?: string) {
    setStatus(undefined);
    try {
      await action();
      if (success) setStatus({ error: false, message: success });
    } catch (failure) {
      setStatus({ error: true, message: (failure as Error).message });
    }
  }

  async function confirmDelete() {
    setDeleteError('');
    try { await remove(); }
    catch (failure) { setDeleteError((failure as Error).message); }
  }

  return <View style={styles.settings}>
    {comingFromOverview && <Button kind="quiet" compact icon={ArrowLeft} onPress={() => router.replace('/')}>Back to Overview</Button>}
    <PageTitle title="Profile" action={<Button icon={Dumbbell} onPress={() => setEquipment(true)}>My equipment</Button>} />
    <Panel style={styles.settingsPanel}>
      <View style={styles.identity}>
        <View style={styles.avatar}><Copy size={24} tone={color.forest} weight="bold">{profile.username[0].toUpperCase()}</Copy></View>
        <View style={{ flex: 1 }}>
          <Copy size={19} weight="bold">{savedName || profile.username}</Copy>
          <Copy size={13} tone={color.muted}>@{profile.username}</Copy>
        </View>
      </View>
      <SectionTitle title="Training preferences" summary="Optional details that shape your workout suggestions." />
      <View style={styles.fieldRow}>
        <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={60} editable={!busy} />
      </View>
      <View style={styles.fieldRow}>
        <Input label="Training goal" value={trainingGoal} onChangeText={setTrainingGoal} maxLength={240} editable={!busy}
          multiline placeholder="What would you like to get better at?" style={{ minHeight: 84, paddingVertical: 10 }} />
      </View>
      <PreferenceFields value={preferences} onChange={setPreferences} disabled={busy} />
      <Button kind="primary" disabled={busy || (displayName.trim() === savedName && trainingGoal.trim() === savedGoal
        && JSON.stringify(preferences) === savedPreferences && profile.details.trainingPreferences?.intake === 'completed')}
        onPress={() => void submit(() => save({ displayName, trainingGoal, trainingPreferences: { ...preferences, intake: 'completed' } }), 'Profile details saved.')} style={styles.action}>
        Save profile
      </Button>
      {status && <Notice error={status.error}
        action={comingFromOverview && !status.error ? <Button compact end={ArrowRight} onPress={() => router.replace('/')}>See today’s suggestion</Button> : undefined}>
        {status.message}
      </Notice>}
    </Panel>
    {equipment && <EquipmentSheet onClose={() => setEquipment(false)} />}
    <TrainingNotes />
    <TrainingProfileHistory key={JSON.stringify(profile.details)} />
    <ProfileArchive />
    <Panel style={styles.settingsPanel}>
      <SectionTitle title="Switch profiles" summary="Sign out to choose another profile or create one. Your training data stays with this profile." />
      <Button icon={LogOut} disabled={busy} onPress={() => void submit(signOut)} style={styles.action}>Sign out</Button>
    </Panel>
    <Panel style={styles.settingsPanel}>
      <SectionTitle title="Delete account" summary="Permanently delete this profile, its workouts, session history, saved exercises, training notes, profile history, check-ins, and videos." />
      <Button kind="danger" icon={Trash2} disabled={busy} style={styles.action}
        onPress={() => { setConfirmation(''); setDeleteError(''); setDeleting(true); }}>Delete account</Button>
    </Panel>
    {deleting && <Sheet title="Delete account" detail={`This will permanently delete @${profile.username} and its training data. Other profiles will remain available.`}
      onClose={() => { if (!busy) setDeleting(false); }}>
      <Input label="Type your username to confirm" value={confirmation} onChangeText={setConfirmation} autoCapitalize="none"
        autoCorrect={false} editable={!busy} maxLength={24} />
      {deleteError && <Notice error>{deleteError}</Notice>}
      <View style={styles.deleteActions}>
        <Button disabled={busy} onPress={() => setDeleting(false)}>Cancel</Button>
        <Button kind="danger" disabled={busy || confirmation.trim() !== profile.username} onPress={() => void confirmDelete()}>
          {busy ? 'Deleting…' : 'Permanently delete account'}
        </Button>
      </View>
    </Sheet>}
  </View>;
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: color.ink },
  entry: { flexGrow: 1, overflow: 'hidden' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 42, paddingVertical: 22,
    borderBottomWidth: 1, borderColor: color.inkLine },
  brandCompact: { paddingHorizontal: 20, paddingVertical: 14 },
  picker: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 34,
    paddingHorizontal: 32, paddingTop: 36, paddingBottom: 106 },
  pickerCompact: { gap: 24, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 76 },
  centered: { textAlign: 'center' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tiles: { width: '100%', maxWidth: 902, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: 20 },
  tilesCompact: { gap: 14 },
  tile: { borderRadius: radius.panel, borderWidth: 2, borderColor: 'transparent', padding: 4, gap: 9 },
  tileHighlighted: { borderColor: color.onInk },
  tileSquare: { width: '100%', aspectRatio: 1, borderRadius: radius.panel, alignItems: 'center', justifyContent: 'center' },
  addSquare: { backgroundColor: color.inkHover, borderWidth: 1, borderColor: color.control, borderStyle: 'dashed' },
  firstTile: { backgroundColor: color.accent },
  tileLabel: { textAlign: 'center', paddingBottom: 3 },
  settings: { width: '100%', maxWidth: 720, gap: 15 },
  settingsPanel: { gap: 14, padding: 19 },
  identity: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingBottom: 14, borderBottomWidth: 1, borderColor: color.line },
  avatar: { width: 49, height: 49, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  fieldRow: { flexDirection: 'row' },
  action: { alignSelf: 'flex-start' },
  deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
});
