import { useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { Notice } from '../components/ui';
import { color } from '../theme';
import type { VideoPlayerProps } from './videoTypes';

export function VideoPlayer({ uri, label, detailed, onReady, onError, ref }: VideoPlayerProps) {
  const [failed, setFailed] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  function seek(seconds: number) {
    const player = video.current;
    if (!player || player.error) return;
    if (player.readyState === 0) {
      pendingSeek.current = seconds;
      return;
    }
    player.pause();
    player.currentTime = seconds;
    player.focus({ preventScroll: true });
    player.scrollIntoView({ block: 'nearest' });
  }
  useImperativeHandle(ref, () => ({
    position: () => video.current?.currentTime ?? 0,
    duration: () => video.current?.duration ?? 0,
    seek,
  }), []);
  return <View style={{ gap: 8 }}>
    <video
      ref={video}
      aria-label={label}
      src={uri}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={() => {
        setFailed(false);
        const player = video.current;
        setPortrait(Boolean(player && player.videoHeight > player.videoWidth));
        const seconds = pendingSeek.current;
        pendingSeek.current = null;
        if (seconds !== null) seek(seconds);
        onReady?.();
      }}
      onError={() => { setFailed(true); onError?.(); }}
      style={{ width: '100%', maxHeight: detailed ? 420 : 350, aspectRatio: detailed && portrait ? '5/4' : '16/9',
        backgroundColor: color.ink, borderRadius: 10 }}
    />
    {failed && <Notice error>This video could not be played in your browser.</Notice>}
  </View>;
}
