import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useImperativeHandle } from 'react';
import type { VideoPlayerProps } from './videoTypes';

export function VideoPlayer({ uri, label, ref, onReady, onError }: VideoPlayerProps) {
  const player = useVideoPlayer(uri);
  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') onReady?.();
      if (status === 'error') onError?.();
    });
    if (player.status === 'readyToPlay') onReady?.();
    if (player.status === 'error') onError?.();
    return () => subscription.remove();
  }, [player, onReady, onError]);
  useImperativeHandle(ref, () => ({
    position: () => player.currentTime,
    duration: () => player.duration,
    seek(seconds) {
      player.pause();
      player.currentTime = seconds;
    },
  }), [player]);
  return <VideoView player={player} accessibilityLabel={label} nativeControls style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10 }} />;
}
