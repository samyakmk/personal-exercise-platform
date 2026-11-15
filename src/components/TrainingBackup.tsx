import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { isTrainingBackupFormat } from '../../shared/training-backup.mjs';
import { earliestWorkoutDate, isWorkoutDate, latestWorkoutDate } from '../dates';
import { BackupPicker } from '../platform/BackupPicker';
import type { BackupFile } from '../platform/BackupPicker';
import { DownloadLink } from '../platform/DownloadLink';
import { DateTimeField } from '../platform/fields';
import { color } from '../theme';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { Button, Copy, Notice, SectionTitle } from './ui';

export function TrainingBackup({ onClose }: { onClose: () => void }) {
  const { api, data, refreshAfterRestore, announce } = useWorkspace();
  const [selected, setSelected] = useState<{ name: string; contents: string; workouts: number; equipment: boolean; bookmarks: number } | null>(null);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [split, setSplit] = useState(false);
  const [from, setFrom] = useState('');
  const [before, setBefore] = useState('');
  const loading = useRef(false);

  async function preview(file: BackupFile) {
    if (loading.current) return;
    setError('');
    setSelected(null);
    if (file.size > 8 * 1024 * 1024) {
      setError('Choose a backup file up to 8 MB.');
      return;
    }
    loading.current = true;
    setBusy(true);
    try {
      const contents = await file.read();
      const backup = JSON.parse(contents);
      if (!isTrainingBackupFormat(backup?.format) || backup.version !== 1 || !Array.isArray(backup.workouts)) {
        throw new Error('Invalid training backup');
      }
      setSelected({ name: file.name, contents, workouts: backup.workouts.length, equipment: Array.isArray(backup.equipment),
        bookmarks: Array.isArray(backup.bookmarks) ? backup.bookmarks.length : 0 });
    } catch {
      setError('Choose a valid Liftmorrow training backup JSON file.');
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }

  async function restore() {
    if (!selected || loading.current) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try {
      const { restore } = await api.restoreTrainingBackup(selected.contents);
      refreshAfterRestore(Boolean(restore.added || restore.equipmentImported || restore.savedExercises));
      const counts = `${restore.added} ${restore.added === 1 ? 'workout' : 'workouts'} added`;
      announce(`${counts}${restore.skipped ? ` · ${restore.skipped} already present` : ''}${restore.equipmentImported ? ' · equipment restored' : ''}${restore.savedExercises ? ` · ${restore.savedExercises} saved ${restore.savedExercises === 1 ? 'exercise' : 'exercises'} added` : ''}.`);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }

  const hasWorkouts = data?.workouts.some(({ example }) => !example);
  const hasPlans = data?.workouts.some(({ example, status }) => !example && status === 'planned');
  const hasHistory = data?.workouts.some(({ example, status }) => !example && status === 'completed');
  const hasData = data?.equipment != null || hasWorkouts || Boolean(data?.bookmarks?.length);
  const validRange = Boolean(from || before) && (!from || isWorkoutDate(from)) && (!before || isWorkoutDate(before))
    && (!from || !before || from < before);
  const download = {
    filename: 'liftmorrow-training-backup.json',
    onStart: () => setDownloadError(''),
    onError: (message: string, status?: number) => {
      setDownloadError(message);
      if (status === 413 && hasWorkouts) setSplit(true);
    },
  };
  return <Sheet title="Export and backup" detail="Download your workout records or move training data to another workspace."
    onClose={() => { if (!loading.current) onClose(); }}>
    {(hasPlans || hasHistory) && <View style={styles.section}>
      <SectionTitle title="Workout exports" level={3} />
      <View style={styles.actions}>
        {hasPlans && <DownloadLink href={api.workoutCalendarUrl()} label="Download calendar" />}
        {hasHistory && <DownloadLink href={api.workoutHistoryUrl()} label="Download history CSV" />}
      </View>
    </View>}
    {hasData && <View style={styles.section}>
      <SectionTitle title="Training backup" level={3} />
      <Copy size={13} tone={color.muted}>Save workouts, saved exercises, and equipment preferences. Video files have their own downloads.</Copy>
      <View style={styles.actions}>
        <DownloadLink href={api.trainingBackupUrl()} label="Download training backup" validated={download} />
        {hasWorkouts && <Button kind="quiet" onPress={() => setSplit(!split)} aria-expanded={split}>
          {split ? 'Hide date options' : 'Choose a date range'}
        </Button>}
      </View>
      {downloadError && <Notice error>{downloadError}</Notice>}
      {split && <View style={styles.range}>
        <Copy size={13} tone={color.muted}>Choose a date range for one part of a large backup. Leave a date blank for an open end.</Copy>
        <View style={styles.dates}>
          <DateTimeField kind="date" label="Include workouts from" value={from}
            min={earliestWorkoutDate} max={latestWorkoutDate} onChange={setFrom} />
          <DateTimeField kind="date" label="Include workouts before" value={before}
            min={earliestWorkoutDate} max={latestWorkoutDate} onChange={setBefore} />
        </View>
        {from && before && from >= before && <Notice error>The end date must be after the start date.</Notice>}
        {validRange && <DownloadLink href={api.trainingBackupUrl(from, before)} label="Download selected dates" validated={download} />}
      </View>}
    </View>}
    <View style={styles.restore}>
      <SectionTitle title="Restore a backup" level={3} />
      <Copy size={13} tone={color.muted}>Restore adds missing workouts and saved exercises. Equipment preferences are restored when this workspace has none saved.</Copy>
      {!selected ? <BackupPicker disabled={busy} onSelect={(file) => void preview(file)} onError={setError} /> : <>
        <Copy size={13} weight="semibold">{selected.name}</Copy>
        <Copy size={13} tone={color.muted}>{[
          `${selected.workouts} ${selected.workouts === 1 ? 'workout' : 'workouts'}`,
          selected.bookmarks > 0 ? `${selected.bookmarks} saved ${selected.bookmarks === 1 ? 'exercise' : 'exercises'}` : null,
          selected.equipment ? 'equipment preferences' : null,
        ].filter(Boolean).join(' · ')}</Copy>
        <View style={styles.actions}>
          <Button kind="primary" disabled={busy} onPress={() => void restore()}>{busy ? 'Restoring…' : 'Restore training data'}</Button>
          <Button disabled={busy} onPress={() => { setSelected(null); setError(''); }}>Choose another file</Button>
        </View>
      </>}
    </View>
    {error && <Notice error>{error}</Notice>}
  </Sheet>;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  restore: { gap: 9, borderTopWidth: 1, borderColor: color.line, paddingTop: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  range: { backgroundColor: color.canvas, borderRadius: 9, padding: 10, gap: 8 },
  dates: { flexDirection: 'row', gap: 8 },
});
