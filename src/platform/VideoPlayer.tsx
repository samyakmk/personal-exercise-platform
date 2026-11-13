import { useVideoPlayer, VideoView } from 'expo-video';

export function VideoPlayer({ uri, label }: { uri: string; label: string; onError?: () => void }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} accessibilityLabel={label} nativeControls style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10 }} />;
}
