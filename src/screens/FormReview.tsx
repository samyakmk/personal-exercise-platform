import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Film, LockKeyhole, Trash2, Upload, Video, X } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api, createId } from '../api';
import { Sheet } from '../components/Sheet';
import { Button, Copy, Empty, IconButton, Notice, PageTitle, Panel, SectionTitle, Tag } from '../components/ui';
import { SelectField } from '../platform/fields';
import { VideoPicker } from '../platform/VideoPicker';
import { VideoPlayer } from '../platform/VideoPlayer';
import { useTrainingNavigation } from '../navigation';
import { color } from '../theme';
import type { Clip, SelectedVideo } from '../types';
import { useWorkspace } from '../workspace';

const maxSize = 50 * 1024 * 1024;

function clipSize(bytes: number) {
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

export function FormReview() {
  const { data, mutate, announce } = useWorkspace();
  const { intent, clear } = useTrainingNavigation();
  const [exercise, setExercise] = useState('');
  const [draft, setDraft] = useState<{ id: string; clip: SelectedVideo } | null>(null);
  const [invalidPreview, setInvalidPreview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Clip | null>(null);
  const [sample, setSample] = useState(false);
  const uploadLock = useRef(false);
  const wide = useWindowDimensions().width >= 1100;

  useEffect(() => {
    if (intent?.type !== 'review') return;
    setExercise(intent.exerciseId);
    clear();
  }, [intent, clear]);

  useEffect(() => () => draft?.clip.dispose(), [draft]);

  if (!data) return null;

  const catalog = data.catalog;
  const recent = new Set(data.workouts.filter((workout) => workout.status === 'completed').slice(-5)
    .flatMap((workout) => workout.exercises.map((entry) => entry.exerciseId)));
  const ordered = [...catalog].sort((a, b) => Number(recent.has(b.id)) - Number(recent.has(a.id)));

  function pick(clip: SelectedVideo) {
    setError('');
    const extension = clip.name.split('.').pop()?.toLowerCase();
    const mime = clip.mime || (extension === 'mp4' ? 'video/mp4' : extension === 'webm' ? 'video/webm' : '');
    if (!['video/mp4', 'video/webm'].includes(mime)) {
      setError('Choose an MP4 or WebM video.');
      clip.dispose();
      return;
    }
    if (clip.size <= 0 || clip.size > maxSize) {
      setError(clip.size <= 0 ? 'This video file is empty.' : 'This video exceeds the 50 MB limit.');
      clip.dispose();
      return;
    }
    setInvalidPreview(false);
    setDraft({ id: createId(), clip: { ...clip, mime } });
  }

  async function upload() {
    if (!draft || invalidPreview || uploadLock.current) return;
    if (!exercise) { setError('Choose the exercise shown in your video.'); return; }
    uploadLock.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate(() => api.uploadClip(draft.id, exercise, draft.clip));
      setDraft(null);
      announce('Video saved to your workspace.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      uploadLock.current = false;
      setBusy(false);
    }
  }

  return <View style={{ gap: 15 }}>
    <PageTitle title="Form review" summary="Upload a clip of your exercise to preview and save it in your workspace." />

    <View style={{ gap: 14, flexDirection: wide ? 'row' : 'column', alignItems: 'stretch' }}>
      <Panel style={[styles.panel, wide && { flex: 1.5 }]}>
        <SectionTitle title="Upload a clip" />
        <SelectField label="Exercise in your clip" placeholder="Choose an exercise" value={exercise} onChange={setExercise} disabled={busy}
          options={ordered.map((item) => ({ value: item.id, label: item.name + (recent.has(item.id) ? ' · Recent' : '') }))} />
        {draft ? <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Copy weight="semibold" size={13} style={{ flex: 1 }}>{draft.clip.name} · {clipSize(draft.clip.size)}</Copy>
            {!busy && <IconButton icon={X} label="Remove selected video" onPress={() => { setDraft(null); setError(''); }} />}
          </View>
          <VideoPlayer key={draft.id} uri={draft.clip.uri} label="Video preview" onError={() => setInvalidPreview(true)} />
          <Button icon={Upload} kind="primary" disabled={busy || invalidPreview} onPress={upload}>{busy ? 'Uploading…' : 'Upload video'}</Button>
        </View> : <VideoPicker onSelect={pick} disabled={busy} />}
        {error && <Notice error>{error}</Notice>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <LockKeyhole size={15} color={color.green} />
          <Copy tone={color.muted} size={12} style={{ flex: 1 }}>Only this browser workspace can access your uploads.</Copy>
        </View>
      </Panel>

      <Panel style={[styles.panel, styles.feedback, wide && { flex: 1 }]}>
        <View style={styles.reviewIcon}><Video size={23} color={color.lime} /></View>
        <Copy size={20} tone={color.white} weight="bold">Form feedback</Copy>
        <Copy size={13} tone="#dce6d9">Analysis is unavailable in this release. Open an example to see how form observations and cues will appear.</Copy>
        <Button icon={ArrowUpRight} kind="primary" compact onPress={() => setSample(true)}>View example feedback</Button>
      </Panel>
    </View>

    <SectionTitle title="Your videos" />
    {data.clips.length === 0 ? <Empty title="No videos yet" message="Your uploaded clips will appear here." icon={Film} />
      : data.clips.map((clip) => {
        const item = catalog.find((entry) => entry.id === clip.exerciseId);
        return <Panel key={clip.id} style={[styles.panel, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }]}>
          <View style={styles.videoIcon}><Film color={color.green} size={20} /></View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Copy weight="bold">{item?.name ?? 'Exercise clip'}</Copy>
            <Copy size={12} tone={color.muted} numberOfLines={1}>{clip.filename} · {clipSize(clip.size)}</Copy>
          </View>
          <Tag>Saved</Tag>
          <Button onPress={() => setSelected(clip)} compact accessibilityLabel={`Open ${clip.filename}`}>Open video</Button>
        </Panel>;
      })}

    {sample && <Sheet title="Example form feedback" detail="Illustrative feedback for a goblet squat." onClose={() => setSample(false)}>
      <Notice>This example is sample data. Analysis of your clips is unavailable in this release.</Notice>
      <View style={styles.example}>
        <Check size={18} color={color.green} />
        <View style={{ flex: 1, gap: 3 }}>
          <Copy weight="bold" size={13}>Observation</Copy>
          <Copy tone={color.muted} size={13}>The weight stays close to the chest throughout the squat.</Copy>
        </View>
      </View>
      <View style={styles.example}>
        <ArrowUpRight size={18} color={color.green} />
        <View style={{ flex: 1, gap: 3 }}>
          <Copy weight="bold" size={13}>Cue to try</Copy>
          <Copy tone={color.muted} size={13}>Lower at a steady pace and keep your whole foot in contact with the floor.</Copy>
        </View>
      </View>
    </Sheet>}

    {selected && <SavedClip clip={selected} title={catalog.find((item) => item.id === selected.exerciseId)?.name ?? 'Exercise video'}
      onClose={() => setSelected(null)} onDelete={async () => {
        await mutate(() => api.deleteClip(selected.id));
        setSelected(null);
        announce('Video deleted.');
      }} />}
  </View>;
}

function SavedClip({ clip, title, onClose, onDelete }: { clip: Clip; title: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    try { await onDelete(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <Sheet title={confirm ? 'Delete video?' : title}
    detail={confirm ? `“${clip.filename}” will be removed from your workspace.` : clip.filename}
    onClose={() => { if (!busy) onClose(); }}>
    {!confirm && <>
      <VideoPlayer uri={api.clipUrl(clip.id)} label="Saved exercise video" />
      <Notice>This video is saved. Form analysis is unavailable in this release.</Notice>
    </>}
    {error && <Notice error>{error}</Notice>}
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {confirm && <Button disabled={busy} onPress={() => { setConfirm(false); setError(''); }}>Keep video</Button>}
      <Button kind={confirm ? 'danger' : 'outline'} icon={Trash2} disabled={busy}
        onPress={() => { if (confirm) void remove(); else setConfirm(true); }}>{busy ? 'Deleting…' : 'Delete video'}</Button>
    </View>
  </Sheet>;
}

const styles = StyleSheet.create({
  panel: { padding: 16, gap: 13, minWidth: 0 },
  feedback: { backgroundColor: color.forest, borderColor: color.forest, alignItems: 'flex-start', justifyContent: 'center', padding: 20 },
  reviewIcon: { width: 45, height: 45, borderRadius: 10, backgroundColor: '#35452a', alignItems: 'center', justifyContent: 'center' },
  videoIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: color.limeSoft, alignItems: 'center', justifyContent: 'center' },
  example: { flexDirection: 'row', gap: 9, backgroundColor: color.canvas, borderRadius: 8, padding: 10 },
});
