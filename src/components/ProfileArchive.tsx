import { useRef, useState } from 'react';
import { Archive, Download, Upload } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { RequestError } from '../api';
import { BackupPicker } from '../platform/BackupPicker';
import type { BackupFile } from '../platform/BackupPicker';
import { DownloadLink } from '../platform/DownloadLink';
import { SelectField } from '../platform/fields';
import { signalWorkspaceUpdate } from '../platform/workspaceUpdates';
import { useProfiles } from '../profiles';
import { color } from '../theme';
import type { ProfileArchiveSummary } from '../types';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { Button, Copy, Notice, Panel, SectionTitle } from './ui';

const maxBytes = 96 * 1024 * 1024;
const names: Record<keyof ProfileArchiveSummary, string> = {
  profile: 'Profile settings and trainer instructions', revisions: 'Profile history', equipment: 'Equipment settings',
  bookmarks: 'Saved exercises', workouts: 'Planned workouts and sessions', trainingNotes: 'Training notes',
  checkIns: 'Private check-ins', clips: 'Clip details and saved form reviews', videos: 'Video files',
};

export function ProfileArchive() {
  const [open, setOpen] = useState(false);
  return <Panel style={styles.section}>
    <SectionTitle title="Data & privacy" summary="This profile is tied to this browser. Export a copy to recover or move your training history." />
    <Button icon={Archive} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(true)}>Export or restore profile</Button>
    {open && <ProfileArchiveSheet onClose={() => setOpen(false)} />}
  </Panel>;
}

function ProfileArchiveSheet({ onClose }: { onClose: () => void }) {
  const { api, data, refreshAfterRestore } = useWorkspace();
  const { reload: refreshProfile } = useProfiles();
  const [media, setMedia] = useState('none');
  const [file, setFile] = useState<BackupFile>();
  const [summary, setSummary] = useState<ProfileArchiveSummary>();
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'restore'>();
  const [error, setError] = useState('');
  const running = useRef(false);
  const playable = (data?.clips ?? []).filter(({ size }) => size > 0);
  const videoOptions = [{ value: 'none', label: 'Without video files' },
    ...(playable.length ? [{ value: 'all', label: 'Include all video files' }] : []),
    ...playable.map(({ id, filename }) => ({ value: id, label: `Include ${filename}` }))];

  async function transfer(mode: 'preview' | 'restore') {
    if (!file || running.current) return;
    running.current = true;
    setBusy(mode);
    setError('');
    try {
      const { records } = await api.restoreProfileArchive(mode, file.body ?? await file.read());
      setSummary(records);
      setRestored(mode === 'restore');
      if (mode === 'restore') {
        refreshAfterRestore(true);
        refreshProfile();
        signalWorkspaceUpdate('profile');
        signalWorkspaceUpdate('companion');
      }
    } catch (failure) {
      if (failure instanceof RequestError && [404, 409].includes(failure.status)) refreshProfile();
      setError((failure as Error).message);
    } finally {
      running.current = false;
      setBusy(undefined);
    }
  }

  return <Sheet title="Data & privacy" onClose={() => { if (!running.current) onClose(); }}>
    <View style={styles.section}>
      <SectionTitle title="Export profile archive" level={3} />
      <Copy size={13}>The archive includes workouts, profile settings and history, saved exercises, training notes, check-ins, and saved form reviews. Keep this file somewhere private.</Copy>
      <SelectField label="Video files to include" options={videoOptions} value={media} disabled={Boolean(busy)} onChange={setMedia} />
      <Copy size={12} tone={color.muted}>For a large video collection, download the archive without videos and export video files individually. Each archive can be up to 96 MiB.</Copy>
      <DownloadLink href={api.profileArchiveUrl(media)} label="Download profile archive" validated={{ filename: 'trainer-plus-profile-archive.json',
        onStart: () => setError(''), onError: (message) => setError(message) }} />
    </View>
    <View style={styles.section}>
      <SectionTitle title="Restore profile archive" level={3} />
      <Copy size={13}>Restore into this profile or create a fresh profile for a separate copy. Existing versions are kept when records differ.</Copy>
      <BackupPicker label="Choose profile archive" inputLabel="Profile archive file" disabled={Boolean(busy)} onError={setError} onSelect={(selected) => {
        setFile(undefined);
        setSummary(undefined);
        setRestored(false);
        setError('');
        if (!selected.size || selected.size > maxBytes) setError('Choose a profile archive up to 96 MiB.');
        else setFile(selected);
      }} />
      {file && <Copy size={12}>{file.name}</Copy>}
      {file && !summary && <Button icon={Download} kind="primary" disabled={Boolean(busy)} onPress={() => void transfer('preview')} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Checking archive…' : 'Preview restore'}
      </Button>}
      {summary && <View style={styles.section} role="region" accessibilityLabel={restored ? 'Restore result' : 'Restore preview'}>
        <SectionTitle title={restored ? 'Archive restored' : 'Restore preview'} level={3} />
        {Object.entries(summary).map(([key, { add, same, conflict }]) => <View key={key} style={styles.count}>
          <Copy size={13} weight="semibold">{names[key as keyof ProfileArchiveSummary]}</Copy>
          <Copy size={12} tone={color.muted}>{`${add} ${restored ? 'restored' : 'to restore'} · ${same} already match · ${conflict} ${conflict === 1 ? 'conflict' : 'conflicts'}`}</Copy>
        </View>)}
        {!restored && <Button icon={Upload} kind="primary" disabled={Boolean(busy)} onPress={() => void transfer('restore')} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Restoring…' : 'Restore archive'}
        </Button>}
      </View>}
      {error && <Notice error>{error}</Notice>}
    </View>
  </Sheet>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  count: { paddingVertical: 5, gap: 3, borderBottomWidth: 1, borderColor: color.line },
});
