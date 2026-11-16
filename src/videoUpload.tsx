import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createId, RequestError } from './api';
import { videoMime } from './platform/videoTypes';
import type { SelectedVideo } from './types';
import { useWorkspace } from './workspace';

type Draft = { id: string; clip: SelectedVideo };
const maxSize = 50 * 1024 * 1024;

const Context = createContext<ReturnType<typeof useUploadState> | null>(null);

function useUploadState() {
  const { api, data, transferClip, startReview, reload, announce } = useWorkspace();
  const [exercise, setExercise] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [uploadFailed, setUploadFailed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => draft?.clip.dispose(), [draft]);
  useEffect(() => () => request.current?.abort(), []);

  function pick(clip: SelectedVideo, exerciseId?: string) {
    if (request.current) { clip.dispose(); return; }
    const mime = videoMime(clip.name, clip.mime);
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(mime)) {
      setError('Choose an MP4, WebM, or MOV video.');
      clip.dispose();
      return;
    }
    if (clip.size <= 0 || clip.size > maxSize) {
      setError(clip.size <= 0 ? 'This video file is empty.' : 'This video exceeds the 50 MB limit.');
      clip.dispose();
      return;
    }
    setError('');
    setUploadFailed(false);
    if (exerciseId !== undefined) setExercise(exerciseId);
    setDraft({ id: createId(), clip: { ...clip, mime } });
  }

  const chooseExercise = useCallback((id: string) => {
    if (request.current) return;
    setExercise(id);
    setError('');
    setUploadFailed(false);
  }, []);

  function clear() {
    if (request.current) return;
    setDraft(null);
    setError('');
    setUploadFailed(false);
  }

  async function upload() {
    if (!draft || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setProgress(0);
    setError('');
    setUploadFailed(false);
    try {
      const saved = await transferClip(draft.id, controller.signal, () => api.uploadClip(draft.id, exercise, draft.clip, controller.signal, (fraction) => {
        setProgress(Math.floor(fraction * 100));
      }));
      setDraft(null);
      if (!saved) {
        setError('This video was removed before the upload was confirmed.');
        setUploadFailed(true);
        return;
      }
      setExercise('');
      announce('Video saved to your workspace.');
      if (!exercise && data?.aiAvailable) {
        void startReview(draft.id, 0).catch(() => {
          announce('Video saved. Open it to start analysis.');
        });
      }
      return draft.id;
    } catch (failure) {
      if (controller.signal.aborted) {
        reload();
        announce('Upload cancelled.');
      } else {
        if (failure instanceof RequestError && failure.status === 410) {
          setDraft(null);
          reload();
        }
        setError((failure as Error).message);
        setUploadFailed(true);
      }
    } finally {
      request.current = null;
      setProgress(null);
    }
  }

  return { draft, error, exercise, progress, uploadFailed, pick, chooseExercise, clear, upload, cancel: () => request.current?.abort() };
}

export function VideoUploadProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useUploadState()}>{children}</Context.Provider>;
}

export function useVideoUpload() {
  const value = useContext(Context);
  if (!value) throw new Error('Video upload provider is missing.');
  return value;
}
