import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleUserRound, LogOut, Plus, Trash2 } from 'lucide-react-native';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Sheet } from '../components/Sheet';
import { emptyPreferences, PreferenceFields, TrainingProfileHistory } from '../components/TrainingPreferences';
import { Button, Copy, Display, Input, Loading, Notice, PageTitle, Panel, SectionTitle, Tag } from '../components/ui';
import { useProfiles } from '../profiles';
import { color } from '../theme';
import type { Profile, ProfileEdit } from '../types';

export function ProfileGate() {
  const { state, loadError, notice, reload, busy, create, signIn } = useProfiles();
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const heading = useRef<View>(null);
  const compact = useWindowDimensions().width < 740;
  const hasProfiles = Boolean(state?.profiles.length);
  const entering = !hasProfiles || adding;

  useEffect(() => {
    if (Platform.OS === 'web') document.title = 'Choose a profile · Liftmorrow';
    (heading.current as unknown as HTMLElement | null)?.focus?.();
  }, []);

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
    void submit(() => create(username), 'create');
  }

  return <ScrollView style={styles.canvas} contentContainerStyle={[styles.entry, compact && { padding: 14 }]} keyboardShouldPersistTaps="handled">
    <View role="main" ref={heading} tabIndex={-1} style={[styles.entryCard, compact && styles.entryCompact]}>
      <View style={[styles.brand, compact && styles.brandCompact]}>
        <View style={styles.brandIdentity}>
          <View style={styles.brandMark} aria-hidden>
            {[13, 20, 27].map((height) => <View key={height} style={[styles.brandStroke, { height }]} />)}
          </View>
          <Copy weight="extra" size={23} tone={color.surface} style={{ letterSpacing: -1.2 }}>
            liftmorrow<Copy weight="extra" size={23} tone={color.accent}>.</Copy>
          </Copy>
        </View>
        {!compact && <View style={{ gap: 12 }}>
          <Display size={49} tone={color.surface}>Make it your training.</Display>
          <Copy tone={color.onInk}>Keep your workouts, progress, and videos together in your own space.</Copy>
        </View>}
      </View>
      <View style={[styles.entryContent, compact && { padding: 22 }]}>
        <Tag>LOCAL PROFILES</Tag>
        {!state ? loadError
          ? <Notice error action={<Button compact onPress={reload}>Retry</Button>}>{loadError}</Notice>
          : <Loading label="Loading profiles…" />
          : <>
            <View style={{ gap: 8 }}>
              <Display accessibilityRole="header" aria-level={1} size={compact ? 39 : 47}>
                {entering ? 'Create your profile' : 'Choose a profile'}
              </Display>
              <Copy tone={color.muted}>{entering
                ? 'Choose a username to get started. No password is needed for local testing.'
                : 'Sign in to a profile saved in this browser.'}</Copy>
            </View>
            {notice !== '' && <Notice>{notice}</Notice>}
            {entering ? <>
              {state.canImportLegacy && <Notice>Your existing workouts, settings, and videos will move into this first profile.</Notice>}
              <View style={{ gap: 6 }}>
                <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
                  autoComplete="off" maxLength={24} editable={!busy} returnKeyType="go" onSubmitEditing={createProfile} />
                <Copy size={12} tone={color.muted}>3–24 letters, numbers, underscores, or hyphens. Start with a letter or number.</Copy>
              </View>
              {error && <Notice error>{error}</Notice>}
              <Button kind="primary" end={ArrowRight} onPress={createProfile} disabled={busy || !username.trim()} style={styles.entryAction}>
                {working === 'create' ? 'Creating profile…' : 'Create profile'}
              </Button>
              {hasProfiles && <Button kind="quiet" disabled={busy} onPress={() => { setAdding(false); setError(''); }}>Back to profiles</Button>}
            </> : <>
              <View style={{ gap: 8 }}>
                {state.profiles.map(({ username: saved, workspaceKey }) => <Button key={workspaceKey} icon={CircleUserRound} end={ArrowRight}
                  accessibilityLabel={'Sign in as ' + saved} disabled={busy} style={styles.entryAction} onPress={() => void submit(() => signIn(saved), workspaceKey)}>
                  {working === workspaceKey ? 'Signing in…' : saved}
                </Button>)}
              </View>
              {error && <Notice error>{error}</Notice>}
              <Button kind="quiet" icon={Plus} disabled={busy} onPress={() => { setUsername(''); setError(''); setAdding(true); }}>Create another profile</Button>
            </>}
          </>}
      </View>
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
  const savedName = profile.details.displayName ?? '';
  const savedGoal = profile.details.trainingGoal ?? '';
  const savedPreferences = JSON.stringify(profile.details.trainingPreferences ?? emptyPreferences);
  const [preferences, setPreferences] = useState(profile.details.trainingPreferences ?? emptyPreferences);
  const [displayName, setDisplayName] = useState(savedName);
  const [trainingGoal, setTrainingGoal] = useState(savedGoal);
  const [deleting, setDeleting] = useState(false);
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
    <PageTitle title="Profile" summary="Make your suggestions fit what you and your trainer are working on." />
    <Panel style={styles.settingsPanel}>
      <View style={styles.identity}>
        <View style={styles.avatar}><Copy size={24} tone={color.plum} weight="bold">{profile.username[0].toUpperCase()}</Copy></View>
        <View style={{ flex: 1 }}>
          <Copy size={19} weight="bold">{savedName || profile.username}</Copy>
          <Copy size={13} tone={color.muted}>@{profile.username}</Copy>
        </View>
        <Tag>LOCAL PROFILE</Tag>
      </View>
      <SectionTitle title="Profile details" summary="These details are optional. You can change them any time." />
      <View style={styles.fieldRow}>
        <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={60} editable={!busy} />
      </View>
      <View style={styles.fieldRow}>
        <Input label="Training goal" value={trainingGoal} onChangeText={setTrainingGoal} maxLength={240} editable={!busy}
          multiline placeholder="What would you like to get better at?" style={{ minHeight: 84, paddingVertical: 10 }} />
      </View>
      <PreferenceFields value={preferences} onChange={setPreferences} disabled={busy} />
      <Button kind="dark" disabled={busy || (displayName.trim() === savedName && trainingGoal.trim() === savedGoal
        && JSON.stringify(preferences) === savedPreferences && profile.details.trainingPreferences?.intake === 'completed')}
        onPress={() => void submit(() => save({ displayName, trainingGoal, trainingPreferences: { ...preferences, intake: 'completed' } }), 'Profile details saved.')} style={styles.action}>
        Save profile
      </Button>
      {status && <Notice error={status.error}>{status.message}</Notice>}
    </Panel>
    <TrainingProfileHistory key={JSON.stringify(profile.details)} />
    <Panel style={styles.settingsPanel}>
      <SectionTitle title="Switch profiles" summary="Sign out to choose another profile or create one. Your training data stays with this profile." />
      <Button icon={LogOut} disabled={busy} onPress={() => void submit(signOut)} style={styles.action}>Sign out</Button>
    </Panel>
    <Panel style={styles.settingsPanel}>
      <SectionTitle title="Delete account" summary="Permanently delete this profile, its workouts, session history, saved exercises, profile history, check-ins, and videos." />
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
  canvas: { flex: 1, backgroundColor: color.canvas },
  entry: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  entryCard: { width: '100%', maxWidth: 840, backgroundColor: color.surface, borderRadius: 19, overflow: 'hidden',
    borderWidth: 1, borderColor: color.line, flexDirection: 'row' },
  entryCompact: { maxWidth: 480, flexDirection: 'column' },
  brand: { width: '42%', minHeight: 406, backgroundColor: color.ink, padding: 34, justifyContent: 'space-between', gap: 28 },
  brandCompact: { width: '100%', minHeight: 0, paddingHorizontal: 20, paddingVertical: 14 },
  brandIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { backgroundColor: color.inkHover, width: 37, height: 37, borderRadius: 10, flexDirection: 'row', gap: 3,
    alignItems: 'center', justifyContent: 'center' },
  brandStroke: { width: 3, borderRadius: 3, backgroundColor: color.accent, transform: [{ rotate: '20deg' }] },
  entryAction: { alignSelf: 'stretch' },
  entryContent: { flex: 1, padding: 37, gap: 17, justifyContent: 'center', minWidth: 0 },
  settings: { width: '100%', maxWidth: 720, gap: 15 },
  settingsPanel: { gap: 14, padding: 19 },
  identity: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingBottom: 14, borderBottomWidth: 1, borderColor: color.line },
  avatar: { width: 49, height: 49, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  fieldRow: { flexDirection: 'row' },
  action: { alignSelf: 'flex-start' },
  deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
});
