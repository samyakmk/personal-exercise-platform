import { Camera, Circle, Square } from 'lucide-react-native';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Copy, Notice } from '../components/ui';
import { color } from '../theme';
import type { SelectedVideo } from '../types';
import type { CameraRecorderProps } from './CameraRecorder';
import { VideoPlayer } from './VideoPlayer';

// Keep the capture window and byte limit within the form-review limits.
const maxSeconds = 20;
const maxBytes = 50 * 1024 * 1024;
const countdownSeconds = 5;
const recordingTypes = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

type Capture = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  clip?: SelectedVideo;
  timer?: ReturnType<typeof setTimeout>;
  stop?: () => void;
};

type CameraState =
  | { phase: 'closed' | 'opening' | 'processing' }
  | { phase: 'preview' | 'countdown' | 'recording'; stream: MediaStream; seconds?: number }
  | { phase: 'review'; clip: SelectedVideo }
  | { phase: 'error'; message: string };

function stopTracks(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function runTimer(capture: Capture, seconds: number, update: (remaining: number) => void, done: () => void) {
  const deadline = performance.now() + seconds * 1000;
  function tick() {
    const remaining = deadline - performance.now();
    if (remaining <= 0) { done(); return; }
    const seconds = Math.ceil(remaining / 1000);
    update(seconds);
    capture.timer = setTimeout(tick, remaining - (seconds - 1) * 1000);
  }
  tick();
}

function createRecorder(stream: MediaStream) {
  for (const mimeType of recordingTypes) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    } catch {
      // A browser can advertise a format that its MediaRecorder cannot open.
    }
  }
  throw new Error('No supported video recording format.');
}

function cameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings to try again.';
    if (error.name === 'NotFoundError') return 'No camera was found. Connect a camera and try again.';
    if (error.name === 'NotReadableError') return 'The camera is unavailable. Check if another app is using it and try again.';
  }
  return 'The camera could not be opened. Check your browser and camera settings and try again.';
}

export function CameraRecorder({ onSelect, disabled, filmingTip, selectionLabel = 'Use recording', alternateAction }: CameraRecorderProps) {
  const active = useRef<Capture | null>(null);
  const [state, setState] = useState<CameraState>({ phase: 'closed' });
  const [playable, setPlayable] = useState(false);
  const panelId = useId();

  const release = useCallback(() => {
    const capture = active.current;
    active.current = null;
    if (!capture) return;
    clearTimeout(capture.timer);
    const recorder = capture.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    // Ending all tracks also stops MediaRecorder.
    stopTracks(capture.stream);
    capture.clip?.dispose();
  }, []);

  const fail = useCallback((capture: Capture, message: string) => {
    if (active.current !== capture) return;
    release();
    setState({ phase: 'error', message });
  }, [release]);

  function close() {
    release();
    setState({ phase: 'closed' });
  }

  useEffect(() => {
    function closeBackgroundCamera() {
      const capture = active.current;
      if (capture && !capture.clip) {
        fail(capture, 'The camera closed when you left this tab. Open it again to record.');
      }
    }
    function closeHiddenCamera() {
      if (document.hidden) closeBackgroundCamera();
    }
    window.addEventListener('pagehide', closeBackgroundCamera);
    document.addEventListener('visibilitychange', closeHiddenCamera);
    return () => {
      window.removeEventListener('pagehide', closeBackgroundCamera);
      document.removeEventListener('visibilitychange', closeHiddenCamera);
      release();
    };
  }, [fail, release]);

  useEffect(() => {
    if (disabled) {
      release();
      setState({ phase: 'closed' });
    }
  }, [disabled, release]);

  async function open() {
    if (disabled || active.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState({ phase: 'error', message: 'Camera access needs HTTPS or localhost and a browser that supports recording.' });
      return;
    }
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function' ||
      !recordingTypes.some((mime) => MediaRecorder.isTypeSupported(mime))) {
      setState({ phase: 'error', message: 'This browser cannot record a supported MP4 or WebM clip.' });
      return;
    }
    const capture: Capture = {};
    active.current = capture;
    setState({ phase: 'opening' });
    setPlayable(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
        },
      });
      if (active.current !== capture) { stopTracks(stream); return; }
      capture.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        fail(capture, 'The camera stopped before the preview opened. Try again.');
        return;
      }
      track.addEventListener('ended', () => {
        if (capture.stream === stream) fail(capture, 'The camera disconnected. Reopen it to try again.');
      }, { once: true });
      setState({ phase: 'preview', stream });
    } catch (error) {
      fail(capture, cameraError(error));
    }
  }

  function startRecording(capture: Capture, stream: MediaStream) {
    if (active.current !== capture) return;
    try {
      const recorder = createRecorder(stream);
      capture.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      const start = performance.now();
      let elapsed: number | undefined;

      recorder.ondataavailable = ({ data }) => {
        if (active.current !== capture || !data.size) return;
        size += data.size;
        if (size > maxBytes) {
          fail(capture, 'This recording exceeds the 50 MB limit. Try a shorter clip.');
          return;
        }
        chunks.push(data);
      };
      recorder.onerror = () => fail(capture, 'Recording failed. Reopen the camera to try again.');
      recorder.onstop = () => {
        if (active.current !== capture) return;
        clearTimeout(capture.timer);
        capture.recorder = undefined;
        capture.stop = undefined;
        capture.stream = undefined;
        stopTracks(stream);
        if (!size || (elapsed ?? performance.now() - start) < 1000) {
          fail(capture, 'Record at least one second of movement before stopping.');
          return;
        }
        const mime = (chunks[0].type || recorder.mimeType).split(';', 1)[0].toLowerCase();
        if (mime !== 'video/webm' && mime !== 'video/mp4') {
          fail(capture, 'The browser recorded an unsupported video format.');
          return;
        }
        const blob = new Blob(chunks, { type: mime });
        const uri = URL.createObjectURL(blob);
        const clip = {
          name: mime === 'video/webm' ? 'Camera recording.webm' : 'Camera recording.mp4',
          mime, size, uri, read: async () => blob, dispose: () => URL.revokeObjectURL(uri),
        };
        capture.clip = clip;
        setState({ phase: 'review', clip });
      };
      capture.stop = () => {
        if (active.current !== capture || recorder.state !== 'recording') return;
        clearTimeout(capture.timer);
        elapsed = performance.now() - start;
        setState({ phase: 'processing' });
        capture.timer = setTimeout(() => fail(capture, 'The recording could not be finished. Try again.'), 5000);
        try { recorder.stop(); }
        catch { fail(capture, 'The recording could not be finished. Try again.'); }
      };
      recorder.start(1000);
      runTimer(capture, maxSeconds, (seconds) => setState({ phase: 'recording', stream, seconds }), capture.stop);
    } catch {
      fail(capture, 'Recording could not start. Reopen the camera or choose an existing video.');
    }
  }

  function countdown() {
    const capture = active.current;
    const stream = capture?.stream;
    if (!capture || !stream || capture.recorder || capture.timer) return;
    runTimer(capture, countdownSeconds, (seconds) => setState({ phase: 'countdown', stream, seconds }),
      () => startRecording(capture, stream));
  }

  function cancelCountdown() {
    const capture = active.current;
    if (!capture?.stream || capture.recorder) return;
    clearTimeout(capture.timer);
    capture.timer = undefined;
    setState({ phase: 'preview', stream: capture.stream });
  }

  function selectClip() {
    const capture = active.current;
    if (!capture?.clip || !playable || disabled) return;
    const clip = capture.clip;
    capture.clip = undefined;
    close();
    onSelect(clip);
  }

  const closed = state.phase === 'closed';
  const live = 'stream' in state;
  const toggleId = panelId + '-toggle';
  function focusToggle() {
    document.getElementById(toggleId)?.focus();
  }
  return <div onKeyDown={(event) => {
    if (event.key === 'Escape' && !closed) {
      event.preventDefault();
      event.stopPropagation();
      close();
      focusToggle();
    }
  }}>
    <View style={styles.wrapper}>
      <View style={styles.actions}>
        <Button nativeID={toggleId} icon={Camera} disabled={disabled} aria-expanded={!closed}
          aria-controls={closed ? undefined : panelId} onPress={closed ? open : close} style={styles.trigger}>
          {closed ? 'Record with camera' : 'Close camera'}
        </Button>
        {alternateAction}
      </View>
      {!closed && <View nativeID={panelId} style={styles.panel}>
        {state.phase === 'opening' && <Notice>Waiting for camera permission…</Notice>}
        {state.phase === 'error' && <>
          <Notice error>{state.message}</Notice>
          <Button style={styles.trigger} onPress={open}>Try camera again</Button>
        </>}
        {live && <>
          <LivePreview stream={state.stream} />
          <View aria-live="polite">
            {state.phase === 'preview' && <>
              <Copy size={13}>{filmingTip || 'Keep your full movement in view. Film a few complete reps or a steady hold.'}</Copy>
              <Copy size={12} tone={color.muted}>{`You’ll have ${countdownSeconds} seconds to get in position. The camera records up to ${maxSeconds} seconds of video without audio.`}</Copy>
            </>}
            {state.phase === 'countdown' && <Copy weight="semibold">Get in position</Copy>}
            {state.phase === 'recording' && <Copy weight="semibold" tone={color.danger}>Recording</Copy>}
          </View>
          {state.seconds !== undefined && <Copy role="timer">
            {`0:${String(state.seconds).padStart(2, '0')} ${state.phase === 'countdown' ? 'until recording starts' : 'remaining'}`}
          </Copy>}
          <Button kind={state.phase === 'recording' ? 'danger' : state.phase === 'countdown' ? 'quiet' : 'primary'}
            icon={state.phase === 'recording' ? Square : state.phase === 'preview' ? Circle : undefined}
            style={styles.trigger} onPress={() => {
              if (state.phase === 'preview') countdown();
              else if (state.phase === 'countdown') cancelCountdown();
              else { active.current?.stop?.(); focusToggle(); }
            }}>
            {state.phase === 'preview' ? 'Start recording' : state.phase === 'countdown' ? 'Cancel countdown' : 'Stop recording'}
          </Button>
        </>}
        {state.phase === 'processing' && <Notice>Preparing your preview…</Notice>}
        {state.phase === 'review' && <>
          <VideoPlayer uri={state.clip.uri} label="Recorded clip preview" onReady={() => setPlayable(true)}
            onError={() => setPlayable(false)} />
          <Copy size={13} tone={color.muted}>Your recording stays on this device until you upload it.</Copy>
          <View style={styles.actions}>
            <Button kind="primary" disabled={!playable} onPress={selectClip}>{selectionLabel}</Button>
            <Button kind="quiet" onPress={() => { release(); void open(); }}>Discard and record again</Button>
          </View>
        </>}
      </View>}
    </View>
  </div>;
}

function LivePreview({ stream }: { stream: MediaStream }) {
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = preview.current;
    if (!element) return;
    element.srcObject = stream;
    return () => { element.srcObject = null; };
  }, [stream]);
  return <video ref={preview} aria-label="Live camera preview" autoPlay muted playsInline
    style={{ width: '100%', maxHeight: 'min(320px, 40dvh)', aspectRatio: '16/9', objectFit: 'contain',
      backgroundColor: color.ink, borderRadius: 10 }} />;
}

const styles = StyleSheet.create({
  wrapper: { gap: 10 },
  trigger: { alignSelf: 'flex-start' },
  panel: { gap: 10, padding: 12, backgroundColor: color.canvas, borderRadius: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
